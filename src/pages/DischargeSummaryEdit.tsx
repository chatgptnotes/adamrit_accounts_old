import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Save, Printer, Sparkles, Download, Eye, Loader2, Edit3, Settings, Camera, Upload, X, Search, Trash2 } from 'lucide-react';
import { useDebounce } from 'use-debounce';
import DischargeSummary from '@/components/DischargeSummary';
import { useVisitDiagnosis } from '@/hooks/useVisitDiagnosis';
import { geminiGenerateContentUrl, geminiGenerateContent } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { downscaleImageForVision } from '@/lib/downscaleImage';
import { captureInAppPhoto, reapplyGeotagToBlob } from '@/lib/captureInAppPhoto';
import { captureGeolocation, type GeoCapture } from '@/lib/geotag';
import { GeotagStatus } from '@/components/GeotagStatus';
import { useToast } from '@/hooks/use-toast';

interface Patient {
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
    corporate?: string;
  };
  visit_type?: string;
  appointment_with?: string;
  diagnosis?: string;
  reason_for_visit?: string;
  discharge_summary?: string;
}

// Helper function to convert HTML to plain text
function htmlToPlainText(html: string): string {
  // Create a temporary div element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  // Replace <br> and </p> tags with newlines
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/p>/gi, '\n\n');
  html = html.replace(/<\/div>/gi, '\n');
  html = html.replace(/<\/li>/gi, '\n');

  // Remove all HTML tags
  html = html.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = html;
  html = textarea.value;

  // Clean up extra whitespace
  html = html.replace(/\n{3,}/g, '\n\n'); // Replace 3+ newlines with 2
  html = html.replace(/^\s+|\s+$/g, ''); // Trim

  return html;
}

// Helper function to wrap long text for better formatting
function wrapText(text: string, maxLength: number = 55): string {
  if (!text || text.length <= maxLength) return text;

  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxLength) {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);

  // Add proper indentation for continuation lines
  return lines.map((line, index) =>
    index === 0 ? line : `                         ${line}`
  ).join('\n');
}

// Helper function to format table field
function formatTableField(label: string, value: string, wrapLength: number = 55): string {
  const paddedLabel = (label + ':').padEnd(25);
  const wrappedValue = wrapText(value, wrapLength);
  return `${paddedLabel}${wrappedValue}`;
}

// Helper function to parse medication string into structured format
function parseMedication(medString: string | any): { name: string; strength: string; route: string; dosage: string; days: string } {
  // Handle case where an object is passed instead of string
  if (typeof medString === 'object' && medString !== null) {
    return {
      name: medString.name || 'Medication',
      strength: medString.strength || 'N/A',
      route: medString.route || 'Oral',
      dosage: medString.dosage || 'As prescribed',
      days: medString.days || 'As directed'
    };
  }

  // Convert to string if not already
  const stringValue = String(medString || '');

  // Remove bullet points and extra spaces
  const cleaned = stringValue.replace(/•\s*/, '').trim();

  // Try to parse different medication formats
  // Format 1: "name strength route dosage days" (e.g., "paracetamol 500mg oral twice-daily 5days")
  // Format 2: "name strength dosage days" (e.g., "paracetamol 2 3 5 10days")
  // Format 3: Hindi mixed format

  const parts = cleaned.split(/\s+/);

  if (parts.length >= 2) {
    // Extract days if present (look for pattern with 'day' or 'दिन')
    let days = 'As directed';
    let lastIndex = parts.length;

    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].match(/\d+\s*days?|\d+\s*दिन|days?|दिन/i)) {
        days = parts[i].replace(/days?/i, ' days');
        lastIndex = i;
        break;
      }
    }

    // Extract medication name (usually first part)
    let name = parts[0] || '';

    // Clean up the name
    name = name.replace(/-/g, ' ');

    // Special handling for edge cases
    if (!name || name === 'N/A' || name.toLowerCase() === 'as' ||
        name.toUpperCase() === 'MEDICATION' || name === '') {
      // Try to find actual medication name in other parts
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part &&
            part.toUpperCase() !== 'MEDICATION' &&
            part !== 'N/A' &&
            part.toLowerCase() !== 'as' &&
            part.toLowerCase() !== 'directed' &&
            part.toLowerCase() !== 'oral' &&
            !part.match(/^\d+$/) &&
            !part.match(/\d+\s*(mg|ml|gm|g|mcg|iu|unit)/i) &&
            !part.match(/^(oral|iv|im|sc|topical|local|nasal|rectal|sublingual)$/i) &&
            !part.match(/\d+\s*days?/i) &&
            !part.match(/^(once|twice|thrice|four)$/i)) {
          name = part.replace(/-/g, ' ');
          break;
        }
      }
    }

    // If still no valid name found, use the whole string up to first numeric/route
    if (!name || name === '' || name.toLowerCase() === 'as') {
      const beforeNumeric = cleaned.split(/\s+(?=\d|oral|iv|im)/i)[0];
      if (beforeNumeric && beforeNumeric !== 'as' && beforeNumeric !== '') {
        name = beforeNumeric;
      } else {
        console.warn('Could not extract medication name from:', cleaned);
        name = 'Medication';
      }
    }

    // Extract strength (usually second part with mg/ml/gm)
    let strength = 'N/A';
    let strengthIndex = 2; // Track where strength ends
    if (parts[1] && parts[1].match(/\d+\s*(mg|ml|gm|g|mcg|iu|unit)/i)) {
      strength = parts[1].toUpperCase();
    } else if (parts[1] && parts[1].match(/^\d+$/)) {
      strength = parts[1] + 'mg'; // Default to mg if no unit specified
    }

    // Extract route (oral, IV, IM, topical, etc.)
    let route = 'Oral'; // Default
    let routeIndex = -1;
    const routePatterns = ['oral', 'iv', 'im', 'sc', 'topical', 'local', 'nasal', 'rectal', 'sublingual'];
    for (let i = strengthIndex; i < lastIndex; i++) {
      if (routePatterns.some(r => parts[i].toLowerCase() === r.toLowerCase())) {
        route = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
        routeIndex = i;
        break;
      }
    }

    // Extract dosage (remaining parts between route and days)
    let dosage = 'As prescribed';
    const dosageStartIndex = routeIndex > 0 ? routeIndex + 1 : strengthIndex;
    const dosageParts = [];
    for (let i = dosageStartIndex; i < lastIndex; i++) {
      dosageParts.push(parts[i]);
    }
    if (dosageParts.length > 0) {
      dosage = dosageParts.join(' ');
      // Format common dosage patterns
      dosage = dosage
        .replace(/twice-daily|twice daily/gi, 'Twice daily')
        .replace(/thrice-daily|thrice daily/gi, 'Thrice daily')
        .replace(/once-daily|once daily/gi, 'Once daily')
        .replace(/four-times/gi, 'Four times daily')
        .replace(/दिन में दो बार/g, 'Twice daily')
        .replace(/दिन में तीन बार/g, 'Thrice daily')
        .replace(/दिन में एक बार/g, 'Once daily')
        .replace(/रात में/g, 'At bedtime')
        .replace(/खाने के बाद/g, 'After meals')
        .replace(/खाने से पहले/g, 'Before meals');
    }

    return {
      name: name.substring(0, 25),  // Keep original case, don't convert to uppercase
      strength: strength.substring(0, 10),
      route: route.substring(0, 8),
      dosage: dosage.substring(0, 30),
      days: days  // Don't truncate days field
    };
  }

  // Fallback for unparseable format
  return {
    name: cleaned.substring(0, 25),  // Keep original case
    strength: 'N/A',
    route: 'Oral',
    dosage: 'As prescribed',
    days: 'As advised'
  };
}

export default function DischargeSummaryEdit() {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();


  // Use the diagnosis hook to get real database data
  const { data: visitDiagnosis, isLoading: diagnosisLoading, error: diagnosisError } = useVisitDiagnosis(visitId || '');

  // State management
  const [patient, setPatient] = useState<Patient | null>(null);
  const [dischargeSummaryText, setDischargeSummaryText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [complications, setComplications] = useState<any[]>([]);

  // Lab results state
  const [formattedLabResults, setFormattedLabResults] = useState<string[]>([]);
  const [abnormalResults, setAbnormalResults] = useState<string[]>([]);

  // Fetch Data loading state
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [fetchProgress, setFetchProgress] = useState('');

  // AI Generation states
  const [isGenerating, setIsGenerating] = useState(false);
  const [showGenerationModal, setShowGenerationModal] = useState(false);
  const [editablePrompt, setEditablePrompt] = useState('');
  const [editablePatientData, setEditablePatientData] = useState<any>({});

  // Camera/Upload OCR states
  const [showCameraDialog, setShowCameraDialog] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessingOCR, setIsProcessingOCR] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedGeo, setCapturedGeo] = useState<GeoCapture | null>(null);
  const [gpsRetryLoading, setGpsRetryLoading] = useState(false);
  const capturedBlobRef = useRef<Blob | null>(null);
  const [extractedNotes, setExtractedNotes] = useState('');
  const [fetchedDataText, setFetchedDataText] = useState('');
  const [dataFetched, setDataFetched] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { toast } = useToast();

  // Lab results state
  const [labResults, setLabResults] = useState<any[]>([]);
  const [visitLabs, setVisitLabs] = useState<any[]>([]);

  // Patient search state
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState<Array<{visit_id: string; name: string; patients_id: string; visit_type: string; appointment_with: string; visit_date: string}>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Debounced auto-save
  const [debouncedText] = useDebounce(dischargeSummaryText, 1500);

  // Load pending OPD extracted notes from CameraUpload (if navigated from OPD Summary)
  useEffect(() => {
    const pendingNotes = localStorage.getItem('opd_extracted_notes');
    if (pendingNotes) {
      setExtractedNotes(pendingNotes);
      localStorage.removeItem('opd_extracted_notes');
    }
  }, []);

  // Fetch patient and visit data
  useEffect(() => {
    const fetchPatientData = async () => {
      if (!visitId) {
        console.error('No visit ID provided');
        setIsLoading(false);
        return;
      }

      try {
        // Fetch visit data with patient information
        const { data: visitData, error: visitError } = await supabase
          .from('visits')
          .select(`
            *,
            patients (
              *
            )
          `)
          .eq('visit_id', visitId)
          .single();

        if (visitError) {
          console.error('Error fetching visit data:', visitError);
          return;
        }

        if (visitData) {
          setPatient(visitData);
          const existingSummary = visitData.opd_summary_text || visitData.discharge_summary || '';
          // Convert HTML to plain text if the summary contains HTML tags
          const summaryToSet = existingSummary.includes('<') && existingSummary.includes('>')
            ? htmlToPlainText(existingSummary)
            : existingSummary;
          setDischargeSummaryText(summaryToSet);
          setOriginalText(summaryToSet);
          if (visitData.extracted_notes) {
            setExtractedNotes(visitData.extracted_notes);
          }
          if (visitData.fetched_data_text) {
            setFetchedDataText(visitData.fetched_data_text);
            setDataFetched(true);
          }
        }
      } catch (error) {
        console.error('Exception while fetching patient data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPatientData();
  }, [visitId]);

  // Auto-save functionality
  useEffect(() => {
    const autoSave = async () => {
      if (
        debouncedText !== undefined &&
        debouncedText !== originalText &&
        patient?.visit_id &&
        !isLoading
      ) {
        setIsSaving(true);

        try {
          const { error } = await supabase
            .from('visits')
            .update({
              discharge_summary: debouncedText,
              extracted_notes: extractedNotes,
              fetched_data_text: fetchedDataText,
              opd_summary_text: debouncedText
            })
            .eq('visit_id', patient.visit_id);

          if (error) {
            console.error('Error auto-saving discharge summary:', error);
          } else {
            setOriginalText(debouncedText);
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 2000);
          }
        } catch (error) {
          console.error('Exception during auto-save:', error);
        } finally {
          setIsSaving(false);
        }
      }
    };

    autoSave();
  }, [debouncedText, originalText, patient?.visit_id, isLoading]);

  // Handle manual save
  const handleSave = async () => {
    if (!patient?.visit_id) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('visits')
        .update({
          discharge_summary: dischargeSummaryText,
          extracted_notes: extractedNotes,
          fetched_data_text: fetchedDataText,
          opd_summary_text: dischargeSummaryText
        })
        .eq('visit_id', patient.visit_id);

      if (error) {
        console.error('Error saving discharge summary:', error);
        alert('Failed to save OPD summary');
      } else {
        setOriginalText(dischargeSummaryText);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
        alert('OPD summary saved successfully!');
      }
    } catch (error) {
      console.error('Exception while saving:', error);
      alert('Failed to save OPD summary');
    } finally {
      setIsSaving(false);
    }
  };

  // Patient search for OPD Summary
  const handlePatientSearch = async (query: string) => {
    setPatientSearchQuery(query);
    if (query.length < 2) {
      setPatientSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setIsSearching(true);
    setShowSearchResults(true);
    try {
      // Search by patient name, patient ID, or visit ID
      const { data, error } = await supabase
        .from('visits')
        .select('visit_id, visit_type, appointment_with, visit_date, patients(name, patients_id)')
        .or(`visit_id.ilike.%${query}%,patients.name.ilike.%${query}%,patients.patients_id.ilike.%${query}%`)
        .order('visit_date', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Search error:', error);
        // Fallback: search visits and filter client-side
        const { data: fallbackData } = await supabase
          .from('visits')
          .select('visit_id, visit_type, appointment_with, visit_date, patients(name, patients_id)')
          .order('visit_date', { ascending: false })
          .limit(100);

        const filtered = (fallbackData || []).filter((v: any) => {
          const name = v.patients?.name?.toLowerCase() || '';
          const pid = v.patients?.patients_id?.toLowerCase() || '';
          const vid = v.visit_id?.toLowerCase() || '';
          const q = query.toLowerCase();
          return name.includes(q) || pid.includes(q) || vid.includes(q);
        }).slice(0, 10);

        setPatientSearchResults(filtered.map((v: any) => ({
          visit_id: v.visit_id,
          name: v.patients?.name || 'Unknown',
          patients_id: v.patients?.patients_id || '',
          visit_type: v.visit_type || '',
          appointment_with: v.appointment_with || '',
          visit_date: v.visit_date || '',
        })));
      } else {
        setPatientSearchResults((data || []).filter((v: any) => v.patients).map((v: any) => ({
          visit_id: v.visit_id,
          name: v.patients?.name || 'Unknown',
          patients_id: v.patients?.patients_id || '',
          visit_type: v.visit_type || '',
          appointment_with: v.appointment_with || '',
          visit_date: v.visit_date || '',
        })));
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle fetching comprehensive data from database
  const handleFetchData = async () => {
    if (!patient || !visitId) {
      alert('No patient data available to fetch');
      return;
    }

    try {
      setIsFetchingData(true);
      setFetchProgress('Fetching patient demographics...');

      // 1. Fetch complete patient data from patients table
      const { data: fullPatientData, error: patientError } = await supabase
        .from('patients')
        .select('*')
        .eq('id', patient.patient_id || patient.patients?.id)
        .single();

      if (patientError && patientError.code !== 'PGRST116') {
        console.error('Error fetching full patient data:', patientError);
      }

      // 2. Fetch visit data for admission/discharge dates
      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select('*')
        .eq('visit_id', visitId)
        .single();

      if (visitError && visitError.code !== 'PGRST116') {
        console.error('Error fetching visit data:', visitError);
      }

      setFetchProgress('Fetching visit data & OT notes...');
      // 3. Fetch OT notes for surgery details
      let { data: otNote, error: otError } = await supabase
        .from('ot_notes')
        .select('*')
        .eq('visit_id', visitId)
        .single();

      if (otError || !otNote) {
        // Try with patient_id if visit_id doesn't work
        const result2 = await supabase
          .from('ot_notes')
          .select('*')
          .eq('patient_id', patient.patient_id || patient.patients?.id)
          .single();

        otNote = result2.data;
        otError = result2.error;
      }

      if (otError && otError.code !== 'PGRST116') {
        console.error('Error fetching OT notes:', otError);
      }

      // 4. Use diagnosis data from the hook - no more database query here
      console.log('🔍 Using diagnosis data from hook:', visitDiagnosis);
      if (visitDiagnosis) {
        console.log('📊 Total diagnosis count:', 1 + (visitDiagnosis.secondaryDiagnoses?.length || 0));
      } else {
      }

      // Check if we have valid visitData with UUID for subsequent queries
      if (!visitData?.id) {
        console.error('❌ Critical: No visitData.id available for database queries');
        alert('Error: Unable to fetch additional data - missing visit UUID. Basic OPD summary will be generated with available data.');
      }

      setFetchProgress('Fetching diagnoses & complications...');
      // 5. Fetch complications using the correct UUID from visitData.id
      let visitComplications = null;
      let compError = null;

      if (visitData?.id) {
        console.log('🔍 Fetching complications for visit:', visitId);
        console.log('🔍 Current visitData.id (UUID):', visitData.id);

        // CRITICAL: Use the same visit UUID resolution logic as FinalBill.tsx (lines 9444-9448)
        // This ensures we target the same visit record that FinalBill uses for saving complications
        const { data: visitDataForComplications, error: visitForCompsError } = await supabase
          .from('visits')
          .select('id')
          .eq('visit_id', visitId)
          .single();

        console.log('🔍 FinalBill-style visit resolution:');

        // Use the UUID that FinalBill would use for saving complications
        const complicationsVisitUUID = visitDataForComplications?.id || visitData.id;

        // Check which visit UUID these 2 specific complications are linked to
        const { data: allComplicationsForPatient, error: allCompsError } = await supabase
          .from('visit_complications')
          .select(`
            *,
            visits!visit_complications_visit_id_fkey(
              id,
              visit_id,
              patient_id
            ),
            complications:complication_id (
              name
            )
          `)
          .eq('visits.patient_id', visitData.patient_id);

        console.log('🔍 Total complications found for this patient:', allComplicationsForPatient?.length || 0);

        // Try to find complications for this patient across all their visits
        const { data: patientComps, error: patientCompsError } = await supabase
          .from('visit_complications')
          .select(`
            *,
            visits!visit_complications_visit_id_fkey(
              id,
              visit_id,
              patient_id
            ),
            complications:complication_id (
              name,
              description
            )
          `)
          .eq('visits.patient_id', visitData.patient_id);

        // Primary query - use the SAME UUID that FinalBill uses for saving
        console.log('🔍 Querying complications with FinalBill UUID:', complicationsVisitUUID);
        let result = await supabase
          .from('visit_complications')
          .select(`
            *,
            complications:complication_id (
              name,
              description
            )
          `)
          .eq('visit_id', complicationsVisitUUID);

        visitComplications = result.data;
        compError = result.error;

        // Enhanced fallback logic to find complications for this logical visit
        if ((!visitComplications || visitComplications.length === 0) && allComplicationsForPatient && allComplicationsForPatient.length > 0) {
          console.log('🔄 Primary UUID query empty, using smart visit matching');

          // Strategy 1: Find complications that match the FinalBill-resolved UUID
          const complicationsByFinalBillUUID = allComplicationsForPatient.filter(comp =>
            comp.visit_id === complicationsVisitUUID
          );

          // Strategy 2: Find complications linked to visits with the same visit_id TEXT
          const complicationsByVisitText = allComplicationsForPatient.filter(comp =>
            comp.visits?.visit_id === visitId
          );

          // Strategy 3: Find complications for this specific patient that might belong to this visit period
          const complicationsForPatient = allComplicationsForPatient.filter(comp =>
            comp.visits?.patient_id === visitData.patient_id
          );

          console.log('🔍 SMART MATCHING RESULTS:');

          if (complicationsByFinalBillUUID && complicationsByFinalBillUUID.length > 0) {
            // Best match: Use complications that match FinalBill's UUID resolution
            visitComplications = complicationsByFinalBillUUID;
          } else if (complicationsByVisitText && complicationsByVisitText.length > 0) {
            // Use complications that match the exact visit_id text (best match)
            visitComplications = complicationsByVisitText;
          } else if (complicationsForPatient && complicationsForPatient.length > 0) {
            // As a last resort, use patient complications (but this should be rare)
            visitComplications = complicationsForPatient;
          } else {
            visitComplications = [];
          }
          compError = allCompsError;
        }

        if (compError && compError.code !== 'PGRST116') {
          console.error('❌ Error fetching complications:', compError);
        } else {
          if (visitComplications && visitComplications.length > 0) {
          }
        }
      } else {
      }

      setFetchProgress('Fetching lab reports & results...');
      // 6. Fetch lab orders - try multiple approaches
      let labOrders = null;
      let labError = null;

      console.log('🔍 Attempting to fetch lab orders...');
      console.log('Available identifiers:', {
        visitId: visitId,
        visitDataId: visitData?.id,
        patientId: patient?.patient_id || patient?.patients?.id
      });

      // Try multiple approaches to fetch lab data
      const labQueryAttempts = [
        {
          field: 'visit_id',
          value: visitData?.id,
          desc: 'Using visit UUID'
        },
        {
          field: 'visit_id',
          value: visitId,
          desc: 'Using visit_id directly (IH25I24003)'
        },
        {
          field: 'patient_id',
          value: patient?.patient_id || patient?.patients?.id,
          desc: 'Using patient_id'
        }
      ];

      for (const attempt of labQueryAttempts) {
        if (!attempt.value) {
          continue;
        }

        try {
          console.log(`🔄 Lab query attempt: ${attempt.desc} (${attempt.field} = ${attempt.value})`);

          const result = await supabase
            .from('visit_labs')
            .select(`
              *,
              lab:lab_id (
                name,
                category,
                normal_range,
                unit,
                reference_range
              )
            `)
            .eq(attempt.field, attempt.value)
            .order('created_at', { ascending: true });

          if (result.data && result.data.length > 0) {
            labOrders = result.data;
            labError = result.error;

            // Debug: Show detailed structure of lab orders
            if (labOrders && labOrders.length > 0) {
              console.log('📋 Lab Orders Structure:');
              labOrders.forEach((order, index) => {
                console.log(`Lab Order ${index + 1}:`, {
                  lab_name: order.lab?.name,
                  lab_category: order.lab?.category,
                  result_value: order.result_value,
                  observed_value: order.observed_value,
                  result: order.result,
                  value: order.value,
                  unit: order.lab?.unit || order.unit,
                  normal_range: order.lab?.normal_range || order.normal_range,
                  reference_range: order.lab?.reference_range || order.reference_range,
                  all_fields: Object.keys(order)
                });
              });
            }
            break; // Success, stop trying other methods
          } else if (result.error && result.error.code !== 'PGRST116') {
            console.error(`❌ Error in lab query (${attempt.desc}):`, result.error);
          } else {
            console.log(`📝 No lab orders found using ${attempt.desc}`);
          }
        } catch (error) {
          console.log(`💥 Exception in lab query (${attempt.desc}):`, error);
        }
      }

      // If still no lab orders, set empty array
      if (!labOrders) {
        labOrders = [];
      }

      // 6b. Fetch lab results from lab_results table - THIS IS THE PRIMARY SOURCE FOR LAB DATA
      let labResultsData = null;
      let labResultsError = null;

      // Debug: Show all available visit identifiers
      console.log('🔬 LAB RESULTS DEBUG - Available Visit Identifiers:');
      console.log('📋 visitId parameter:', visitId);
      console.log('📋 visitData.id:', visitData?.id);
      console.log('📋 visitData.visit_id:', visitData?.visit_id);
      console.log('📋 visitData.patient_id:', visitData?.patient_id);
      console.log('📋 patient.visit_id:', patient?.visit_id);
      console.log('📋 patient.id:', patient?.id);
      console.log('📋 patient name:', patient?.patients?.name);
      console.log('📋 Full visitData object:', visitData);
      console.log('📋 Full patient object keys:', patient ? Object.keys(patient) : 'null');

      // Always attempt to fetch lab results, not just when visitData.id exists
      console.log('🔍 Attempting to fetch lab results from lab_results table...');

      // Based on database schema analysis: lab_results uses patient_name (denormalized)
      // visit_id is a UUID foreign key to visits.id
      const patientNameForQuery = patient?.patients?.name || visitData?.patient_name || patient?.name || '';
      console.log('🎯 Patient name for lab results query:', patientNameForQuery);

      // Strategy: Try visit_id (UUID) first for exact match, then patient_name with ilike
      const labResultsSelect = `
        id, main_test_name, test_name, test_category, result_value, result_unit,
        reference_range, comments, is_abnormal, result_status, technician_name,
        pathologist_name, authenticated_result, created_at, visit_id, patient_name, visit_lab_id
      `;

      // Attempt 1: Query by visit UUID (most precise)
      if (visitData?.id) {
        try {
          const { data: results, error: resultsError } = await supabase
            .from('lab_results')
            .select(labResultsSelect)
            .eq('visit_id', visitData.id)
            .order('created_at', { ascending: true });

          if (!resultsError && results && results.length > 0) {
            labResultsData = results;
          }
        } catch (error) {
          console.error('💥 Exception querying lab_results by visit UUID:', error);
        }
      }

      // Attempt 2: Query by patient name (case-insensitive) if visit UUID didn't work
      if ((!labResultsData || labResultsData.length === 0) && patientNameForQuery) {
        try {
          const { data: results, error: resultsError } = await supabase
            .from('lab_results')
            .select(labResultsSelect)
            .ilike('patient_name', patientNameForQuery.trim())
            .order('created_at', { ascending: true });

          if (!resultsError && results && results.length > 0) {
            labResultsData = results;
          }
        } catch (error) {
          console.error('💥 Exception querying lab_results by patient name:', error);
        }
      }

      // Attempt 3: Fuzzy match on patient name (contains)
      if ((!labResultsData || labResultsData.length === 0) && patientNameForQuery) {
        try {
          const { data: results, error: resultsError } = await supabase
            .from('lab_results')
            .select(labResultsSelect)
            .ilike('patient_name', `%${patientNameForQuery.trim()}%`)
            .order('created_at', { ascending: true });

          if (!resultsError && results && results.length > 0) {
            // If we have visit_id, prefer visit-specific results
            if (visitData?.id) {
              const visitSpecific = results.filter((r: any) => r.visit_id === visitData.id);
              labResultsData = visitSpecific.length > 0 ? visitSpecific : results;
            } else {
              labResultsData = results;
            }
          }
        } catch (error) {
          console.error('💥 Exception in fuzzy lab_results query:', error);
        }
      }

      if (!labResultsData || labResultsData.length === 0) {
        labResultsData = [];
      }

      // Store lab results in state
      console.log('📊 Final labResultsData to store:', labResultsData?.length || 0, 'results');
      setLabResults(labResultsData || []);

      // 6c. Fetch lab test orders from visit_labs table (ordered tests from billing page)
      let visitLabsData = [];
      console.log('🔬 Fetching lab test orders from visit_labs table...');

      if (visitData?.id) {
        try {
          const { data: visitLabsRaw, error: visitLabsError } = await supabase
            .from('visit_labs' as any)
            .select('*')
            .eq('visit_id', visitData.id)
            .order('ordered_date', { ascending: false });

          if (visitLabsError) {
            console.error('❌ Error fetching visit_labs:', visitLabsError);
          } else if (visitLabsRaw && visitLabsRaw.length > 0) {

            // Get lab details for each lab_id
            const labIds = visitLabsRaw.map((item: any) => item.lab_id);
            const { data: labsData, error: labsError } = await supabase
              .from('lab')
              .select('id, name, description, category')
              .in('id', labIds);

            if (labsError) {
              console.error('❌ Error fetching lab details:', labsError);
              visitLabsData = visitLabsRaw.map((item: any) => ({
                ...item,
                lab_name: `Lab ID: ${item.lab_id}`,
                test_name: `Test ${item.lab_id}`
              }));
            } else {
              // Combine visit_labs with lab details
              visitLabsData = visitLabsRaw.map((visitLab: any) => {
                const labDetail = labsData?.find((l: any) => l.id === visitLab.lab_id);
                return {
                  ...visitLab,
                  lab_name: labDetail?.name || `Lab ${visitLab.lab_id}`,
                  test_name: labDetail?.name || 'Unknown Test',
                  description: labDetail?.description || '',
                  category: labDetail?.category || ''
                };
              });
              console.log('📋 Formatted visit_labs data:', visitLabsData);
            }
          } else {
          }
        } catch (error) {
          console.error('💥 Exception fetching visit_labs:', error);
        }
      } else {
      }

      // Store visit_labs in state for AI generation
      setVisitLabs(visitLabsData || []);

      setFetchProgress('Fetching radiology reports...');
      // 7. Fetch radiology orders using the correct UUID from visitData.id
      let radiologyOrders = null;
      let radError = null;

      if (visitData?.id) {
        console.log('🔍 Fetching radiology orders for visit UUID:', visitData.id);
        try {
          const result = await supabase
            .from('visit_radiology')
            .select(`
              *,
              radiology:radiology_id (
                name,
                category
              )
            `)
            .eq('visit_id', visitData.id)
            .order('created_at', { ascending: true });

          radiologyOrders = result.data;
          radError = result.error;
        } catch (error) {
          radiologyOrders = [];
        }

        if (radError && radError.code !== 'PGRST116') {
          console.error('Error fetching radiology orders:', radError);
          radiologyOrders = [];
        }
      } else {
        radiologyOrders = [];
      }

      setFetchProgress('Fetching prescriptions & medications...');
      // 8. Fetch pharmacy/prescription data
      let prescriptionData = null;
      let prescriptionError = null;

      if (visitData?.id || visitId) {
        console.log('🔍 Fetching prescription/pharmacy data for visit:', visitId);
        try {
          // Try to fetch from prescriptions table if it exists
          const { data: prescriptions, error: prescError } = await supabase
            .from('prescriptions')
            .select('*')
            .or(`visit_id.eq.${visitData?.id},visit_id.eq.${visitId}`)
            .order('created_at', { ascending: true });

          if (prescriptions && !prescError) {
            prescriptionData = prescriptions;
          }
        } catch (error) {
        }

        // Try visit_medications table first (plural) with JOIN to get medication names
        if (!prescriptionData) {
          try {
            // First try with JOIN to get medication names
            const { data: visitMedications, error: medError } = await supabase
              .from('visit_medications')
              .select(`
                *,
                medication:medication_id (
                  name,
                  description
                )
              `)
              .eq('visit_id', visitData?.id || visitId)
              .order('created_at', { ascending: true });

            if (visitMedications && !medError) {
              prescriptionData = visitMedications;
            } else if (medError) {
            }
          } catch (error) {
          }
        }

        // Try visit_pharmacy table as fallback
        if (!prescriptionData) {
          try {
            const { data: visitPharmacy, error: pharmError } = await supabase
              .from('visit_pharmacy')
              .select(`
                *,
                medication:medication_id (
                  name,
                  dosage,
                  route
                )
              `)
              .eq('visit_id', visitData?.id || visitId)
              .order('created_at', { ascending: true });

            if (visitPharmacy && !pharmError) {
              prescriptionData = visitPharmacy;
            }
          } catch (error) {
          }
        }
      }

      setFetchProgress('Processing & formatting all data...');
      // Process the fetched data
      const patientInfo = fullPatientData || patient.patients || {};
      const visit = visitData || patient;

      // Process diagnoses from the hook data
      const primaryDiagnosis = visitDiagnosis?.primaryDiagnosis || patient.diagnosis || 'No diagnosis recorded';
      const secondaryDiagnoses = visitDiagnosis?.secondaryDiagnoses || [];

      // Process complications - only use complications specifically linked to this visit
      console.log('🔍 DEBUG: Processing complications...');

      if (visitComplications && visitComplications.length > 0) {
        console.log('🔍 DEBUG: Individual complications:');
        visitComplications.forEach((comp, index) => {
          console.log(`  [${index}]:`, {
            raw_comp: comp,
            complications_object: comp.complications,
            name: comp.complications?.name,
            description: comp.complications?.description
          });
        });
      }

      // Try multiple extraction methods for different data structures
      let complications = [];

      if (visitComplications && visitComplications.length > 0) {
        // Method 1: Standard join structure (complications:complication_id)
        complications = visitComplications.map(c => c.complications?.name).filter(Boolean);

        // Method 2: If Method 1 fails, try direct name access
        if (complications.length === 0) {
          complications = visitComplications.map(c => c.name).filter(Boolean);
        }

        // Method 3: If still empty, try nested complication_id access
        if (complications.length === 0) {
          complications = visitComplications.map(c => c.complication_id?.name).filter(Boolean);
        }

        // Method 4: If still empty, check for different property names
        if (complications.length === 0) {
          complications = visitComplications.map(c => {
            // Try various possible property paths
            return c.complications?.name ||
                   c.complication?.name ||
                   c.name ||
                   c.complication_name ||
                   'Unknown Complication';
          }).filter(name => name && name !== 'Unknown Complication');
        }
      }

      console.log('🔍 Final processed complications array:', complications);
      console.log('🔍 Final complications length:', complications.length);
      console.log('🔍 Extraction method used:', complications.length > 0 ? 'Success' : 'All methods failed');

      // Store complications in component state for use by handleAIGenerate
      setComplications(complications);

      // Process lab tests with fallback data
      let labTests = labOrders?.map(l => l.lab?.name).filter(Boolean) || [];

      // Debug lab orders structure
      console.log('🔬 Lab Orders Debug:', {
        count: labOrders?.length || 0,
        sample: labOrders?.[0] || 'none',
        fields: labOrders?.[0] ? Object.keys(labOrders[0]) : 'no fields'
      });

      // Process lab orders - include both with and without results
      let labResultsList = labOrders?.map(l => {
        const testName = l.lab?.name || l.test_name || 'Lab Test';
        const resultValue = l.result_value || l.observed_value || l.result || l.value || null;
        const unit = l.lab?.unit || l.unit || l.result_unit || '';
        const range = l.lab?.normal_range || l.lab?.reference_range ||
                     l.normal_range || l.reference_range || '';

        if (resultValue) {
          const valueWithUnit = `${resultValue}${unit ? ' ' + unit : ''}`;
          return range ? `${testName}: ${valueWithUnit} (Ref: ${range})` :
                        `${testName}: ${valueWithUnit}`;
        } else {
          return range ? `${testName}: Pending (Ref: ${range})` :
                        `${testName}: Results Pending`;
        }
      }) || [];

      // Process lab results - PRIORITIZE visit_labs (ordered tests from billing page)
      let formattedLabResultsLocal = [];
      let abnormalResultsLocal = [];

      try {
        console.log('🧪 LAB RESULTS PROCESSING DEBUG:');
        console.log('📊 visitLabsData exists:', !!visitLabsData);
        console.log('📊 visitLabsData length:', visitLabsData?.length || 0);
        console.log('📊 labResultsData exists:', !!labResultsData);
        console.log('📊 labResultsData length:', labResultsData?.length || 0);

      // Process visit_labs enriched with actual results from lab_results
      if (visitLabsData && visitLabsData.length > 0) {

        // Track which lab_results have been matched to avoid duplicates
        const matchedLabResultIds = new Set<string>();

        visitLabsData.forEach(test => {
          const testName = test.test_name || test.lab_name || 'Unknown Test';

          // Find ALL matching results for this test (panel tests have multiple sub-tests like CBC -> Hb, WBC, ESR, etc.)
          let matchedResults: any[] = [];
          if (labResultsData && labResultsData.length > 0) {
            // Match by visit_lab_id (most precise)
            matchedResults = labResultsData.filter((r: any) => r.visit_lab_id === test.id);

            // If no visit_lab_id match, match by name (panel name -> main_test_name)
            if (matchedResults.length === 0) {
              const labName = (test.test_name || test.lab_name || '').toLowerCase();
              matchedResults = labResultsData.filter((r: any) =>
                (r.main_test_name || '').toLowerCase().includes(labName) ||
                labName.includes((r.main_test_name || '').toLowerCase()) ||
                (r.visit_lab_id === null && (r.test_name || '').toLowerCase().includes(labName))
              );
            }

            // Track matched IDs
            matchedResults.forEach((r: any) => matchedLabResultIds.add(r.id));
          }

          if (matchedResults.length > 0) {
            // Panel test with sub-results — show heading then each sub-test
            formattedLabResultsLocal.push(`\n**${testName}:**`);
            matchedResults.forEach((result: any) => {
              if (result.result_value) {
                const subTestName = result.test_name || result.main_test_name || testName;
                const valueWithUnit = `${result.result_value}${result.result_unit ? ' ' + result.result_unit : ''}`;
                const refRange = result.reference_range ? ` (Ref: ${result.reference_range})` : '';
                const abnormalFlag = result.is_abnormal ? ' ⚠ ABNORMAL' : ' ✓';
                formattedLabResultsLocal.push(`  • ${subTestName}: ${valueWithUnit}${refRange}${abnormalFlag}`);
                if (result.is_abnormal) {
                  abnormalResultsLocal.push(`${subTestName}: ${valueWithUnit}`);
                }
              }
            });
          } else {
            formattedLabResultsLocal.push(`• ${testName}: Ordered - Pending`);
          }
        });

        // Also include any extra results from lab_results not matched to visit_labs
        if (labResultsData && labResultsData.length > 0) {
          const extraResults = labResultsData.filter((r: any) => !matchedLabResultIds.has(r.id));
          if (extraResults.length > 0) {
            console.log(`📋 Found ${extraResults.length} extra lab results not matched to visit_labs`);
            extraResults.forEach((result: any) => {
              const valueWithUnit = result.result_value
                ? `${result.result_value}${result.result_unit ? ' ' + result.result_unit : ''}`
                : 'N/A';
              const refRange = result.reference_range ? ` (Ref: ${result.reference_range})` : '';
              const abnormalFlag = result.is_abnormal ? ' ⚠ ABNORMAL' : ' ✓';
              formattedLabResultsLocal.push(`• ${result.test_name || result.main_test_name}: ${valueWithUnit}${refRange}${abnormalFlag}`);
              if (result.is_abnormal && result.result_value) {
                abnormalResultsLocal.push(`${result.test_name}: ${valueWithUnit}`);
              }
            });
          }
        }
      }
      // Fallback: process lab_results directly if no visit_labs
      else if (labResultsData && labResultsData.length > 0) {

        // Group results by test category or main_test_name for better organization
        const groupedResults = {};
        labResultsData.forEach(result => {
          const groupKey = result.main_test_name || result.test_category || 'General Tests';
          if (!groupedResults[groupKey]) {
            groupedResults[groupKey] = [];
          }
          groupedResults[groupKey].push(result);
        });

        // Format results by groups
        Object.keys(groupedResults).forEach(groupName => {
          const results = groupedResults[groupName];
          formattedLabResultsLocal.push(`\n**${groupName}:**`);

          results.forEach(result => {
            const abnormalFlag = result.is_abnormal ? ' ⚠ ABNORMAL' : ' ✓';
            const valueWithUnit = result.result_value ?
              `${result.result_value}${result.result_unit ? ' ' + result.result_unit : ''}` : 'N/A';
            formattedLabResultsLocal.push(`• ${result.test_name}: ${valueWithUnit}${abnormalFlag}`);

            if (result.is_abnormal && result.result_value) {
              abnormalResultsLocal.push(`${result.test_name}: ${valueWithUnit}`);
            }

            if (result.comments) {
              formattedLabResultsLocal.push(`  Comment: ${result.comments}`);
            }
          });
        });
      }

        console.log('🔬 Formatted lab results:', formattedLabResultsLocal);

        // Debug final data before summary generation
        console.log('📋 FINAL SUMMARY DATA:');
        console.log('🧪 formattedLabResults.length:', formattedLabResultsLocal.length);
        console.log('🧪 labResultsList.length:', labResultsList.length);
        console.log('🧪 abnormalResults.length:', abnormalResultsLocal.length);
        console.log('🧪 Sample formattedLabResults:', formattedLabResultsLocal.slice(0, 3));

      } catch (labError) {
        console.error('💥 Error processing lab results:', labError);
        console.log('🛡️ Using fallback empty arrays for lab results');
        formattedLabResultsLocal = [];
        abnormalResultsLocal = [];
      }

      // Update state with lab results
      setFormattedLabResults(formattedLabResultsLocal);
      setAbnormalResults(abnormalResultsLocal);

      // Process radiology tests with fallback data
      let radiologyTests = radiologyOrders?.map(r => r.radiology?.name).filter(Boolean) || [];

      // No static/dummy data as requested by user - only use real database data

      // Construct comprehensive discharge summary in professional English narrative format
      const patientName = patientInfo.name || patient.patients?.name || 'Unknown Patient';
      const patientAge = patientInfo.age || patient.patients?.age || 'Unknown';
      const patientGender = patientInfo.gender || patient.patients?.gender || 'Unknown';
      const visitDate = visit.visit_date ? new Date(visit.visit_date).toLocaleDateString() : 'Unknown Date';
      const doctorName = visit.appointment_with || 'Dr. Unknown';

      // Define complaints from visit diagnosis or reason for visit
      const complaints = visitDiagnosis?.complaints ||
                        (patient.reason_for_visit ? [patient.reason_for_visit] : []);

      // Create medications table
      let medicationsTable = '';
      let medicationsToUse = [];

      if (visitDiagnosis?.medications && visitDiagnosis.medications.length > 0) {
        medicationsToUse = visitDiagnosis.medications;
      } else if (prescriptionData && prescriptionData.length > 0) {
        // Use fetched prescription data if available
        medicationsToUse = prescriptionData.map(p => {
          // Log the complete structure to find the correct field

          // Check if data is from visit_medications table
          // Try ALL possible field names for medication name
          let medName = '';

          // First check if medication object exists (from JOIN)
          if (p.medication && typeof p.medication === 'object' && p.medication.name) {
            medName = p.medication.name;
          }
          // Otherwise check various possible field names
          else {
            const possibleNameFields = [
              'medication_name', 'name', 'medicine_name',
              'drug_name', 'item_name', 'drug', 'item', 'medicine',
              'med_name', 'product_name', 'generic_name'
            ];

            for (const field of possibleNameFields) {
              if (p[field] && typeof p[field] === 'string' &&
                  p[field] !== 'MEDICATION' && p[field] !== 'N/A' &&
                  p[field] !== 'as directed') {
                medName = p[field];
                break;
              }
            }

            // If still no name found, check if any field is an object with name
            if (!medName) {
              for (const field of possibleNameFields) {
                if (p[field] && typeof p[field] === 'object' && p[field].name) {
                  medName = p[field].name;
                  break;
                }
              }
            }
          }

          // Use actual medication name or log error
          if (!medName) {
            console.error('❌ Could not find medication name in record:', p);
            console.error('Please check database for correct field name');
            // Don't default to generic name
            medName = '';
          }

          const dosage = p.dose || p.dosage || p.strength || '';
          const route = p.route || 'Oral';
          const frequency = p.frequency || 'as directed';
          const duration = p.duration || p.days || 'As directed';


          // Return formatted medication string with actual name
          // Make sure to include all fields properly separated
          return `${medName} ${dosage} ${route} ${frequency} ${duration}`;
        });
        console.log('📝 Using fetched prescription data:', medicationsToUse);
      } else {
        // No medications prescribed
        medicationsToUse = [];
      }

      medicationsTable = `**MEDICATIONS (TREATMENT ON DISCHARGE):**

| Medication Name | Strength | Route | Dosage | Duration |
|-----------------|----------|-------|--------|----------|
`;
      medicationsToUse.forEach(med => {
        // Parse medication string into structured format
        const parsed = parseMedication(med);
        medicationsTable += `| ${parsed.name} | ${parsed.strength || '-'} | ${parsed.route || 'PO'} | ${parsed.dosage || '-'} | ${parsed.days || '-'} |
`;
      });

      // Create present condition narrative
      const presentConditionText = complications.length > 0
        ? `The patient presented with ${primaryDiagnosis.toLowerCase()}${secondaryDiagnoses.length > 0 ? ` along with ${secondaryDiagnoses.join(', ').toLowerCase()}` : ''}. During the course of treatment, the following complications were noted: ${complications.join(', ').toLowerCase()}.`
        : `The patient presented with ${primaryDiagnosis.toLowerCase()}${secondaryDiagnoses.length > 0 ? ` along with ${secondaryDiagnoses.join(', ').toLowerCase()}` : ''}. The patient showed good response to treatment with no significant complications during the hospital stay.`;

      // Create case summary narrative
      const caseSummaryText = otNote
        ? `This ${patientAge} year old ${patientGender.toLowerCase()} patient was seen on ${visitDate} with ${primaryDiagnosis.toLowerCase()}. The patient underwent ${otNote.surgery_name || 'surgical procedure'} performed by ${otNote.surgeon || 'the attending surgeon'} under ${otNote.anaesthesia || 'appropriate anaesthesia'}. ${otNote.procedure_performed ? `The procedure involved ${otNote.procedure_performed.toLowerCase()}.` : ''} ${otNote.description ? `Post-operative notes indicate ${otNote.description.toLowerCase()}.` : ''} The patient's recovery was satisfactory.`
        : `This ${patientAge} year old ${patientGender.toLowerCase()} patient was admitted on ${visitDate} with ${primaryDiagnosis.toLowerCase()}. The patient received appropriate medical management and showed good clinical improvement. All vital parameters were stable at the time of visit.`;

      // Create medications narrative
      const medicationsText = visitDiagnosis?.medications && visitDiagnosis.medications.length > 0
        ? `The following medications were prescribed: ${visitDiagnosis.medications.map((med, index) => {
            // Convert medication format from technical to narrative
            const medText = med.replace(/•\s*/, '').replace(/दिन में दो बार/g, 'twice daily').replace(/दिन में एक बार/g, 'once daily').replace(/रात में/g, 'at bedtime').replace(/खाने के बाद/g, 'after meals').replace(/खाने से पहले/g, 'before meals');
            return index === visitDiagnosis.medications.length - 1 ? `and ${medText}` : medText;
          }).join(', ')}. All medications should be taken as prescribed and the patient should complete the full course of treatment.`
        : `No specific medications were prescribed. The patient should continue with general supportive care as advised.`;

      // Create lab results table format
      let labResultsTable = '';
      // Check if we have any lab data to display - prioritize visit_labs
      const hasLabData = (visitLabsData && visitLabsData.length > 0) ||
                        (labResultsData && labResultsData.length > 0) ||
                        (labOrders && labOrders.length > 0) ||
                        (formattedLabResultsLocal && formattedLabResultsLocal.length > 0) ||
                        (labResultsList && labResultsList.length > 0);

      if (hasLabData) {
        labResultsTable = `================================================================================
LABORATORY INVESTIGATIONS:
================================================================================
Test Name                       Result              Reference Range     Status
--------------------------------------------------------------------------------\n`;

        // PRIORITY: Add lab tests from visit_labs table, enriched with actual results from lab_results
        if (visitLabsData && visitLabsData.length > 0) {
          console.log('📊 Including lab tests from visit_labs table:', visitLabsData.length, 'tests');
          visitLabsData.forEach(test => {
            const testName = (test.test_name || test.lab_name || 'Unknown Test').substring(0, 30).padEnd(30);

            // Check if there's an actual result in lab_results for this test
            let matchedResult: any = null;
            if (labResultsData && labResultsData.length > 0) {
              // Match by visit_lab_id first (most precise)
              matchedResult = labResultsData.find((r: any) => r.visit_lab_id === test.id);
              // Fallback: match by test name (case-insensitive)
              if (!matchedResult) {
                const labName = (test.test_name || test.lab_name || '').toLowerCase();
                matchedResult = labResultsData.find((r: any) =>
                  (r.main_test_name || '').toLowerCase().includes(labName) ||
                  labName.includes((r.test_name || '').toLowerCase())
                );
              }
            }

            if (matchedResult && matchedResult.result_value) {
              const value = `${matchedResult.result_value}${matchedResult.result_unit ? ' ' + matchedResult.result_unit : ''}`.substring(0, 18).padEnd(18);
              const range = (matchedResult.reference_range || test.description || '-').substring(0, 18).padEnd(18);
              const status = matchedResult.is_abnormal ? '⚠ ABNORMAL' : '✓ Normal';
              labResultsTable += `${testName} ${value} ${range} ${status}\n`;
            } else {
              const value = 'Ordered'.substring(0, 18).padEnd(18);
              const range = (test.description || '-').substring(0, 18).padEnd(18);
              const status = 'Pending';
              labResultsTable += `${testName} ${value} ${range} ${status}\n`;
            }
          });

          // Also add any lab_results that don't match a visit_lab (extra results)
          if (labResultsData && labResultsData.length > 0) {
            const visitLabIds = new Set(visitLabsData.map((t: any) => t.id));
            const visitLabNames = new Set(visitLabsData.map((t: any) => (t.test_name || t.lab_name || '').toLowerCase()));
            const extraResults = labResultsData.filter((r: any) => {
              if (r.visit_lab_id && visitLabIds.has(r.visit_lab_id)) return false;
              const rName = (r.test_name || '').toLowerCase();
              const rMainName = (r.main_test_name || '').toLowerCase();
              return !Array.from(visitLabNames).some((n: any) => rMainName.includes(n) || n.includes(rName));
            });
            if (extraResults.length > 0) {
              console.log('📊 Adding extra lab results not in visit_labs:', extraResults.length);
              extraResults.forEach((result: any) => {
                const testName = (result.test_name || result.main_test_name || 'Unknown Test').substring(0, 30).padEnd(30);
                const value = (result.result_value ? `${result.result_value}${result.result_unit ? ' ' + result.result_unit : ''}` : 'N/A').substring(0, 18).padEnd(18);
                const range = (result.reference_range || 'N/A').substring(0, 18).padEnd(18);
                const status = result.is_abnormal ? '⚠ ABNORMAL' : '✓ Normal';
                labResultsTable += `${testName} ${value} ${range} ${status}\n`;
              });
            }
          }
        }
        // Fallback: use lab_results directly if no visit_labs
        else if (labResultsData && labResultsData.length > 0) {
          console.log('📊 Including lab results from lab_results table (no visit_labs found):', labResultsData.length, 'results');
          labResultsData.forEach(result => {
            const testName = (result.test_name || 'Unknown Test').substring(0, 30).padEnd(30);
            const value = (result.result_value ? `${result.result_value}${result.result_unit ? ' ' + result.result_unit : ''}` : 'N/A').substring(0, 18).padEnd(18);
            const range = (result.reference_range || 'N/A').substring(0, 17).padEnd(17);
            const status = result.is_abnormal ? '⚠ ABNORMAL' : '✓ Normal';
            labResultsTable += `${testName}${value}${range} ${status}\n`;
          });
        } else if (labOrders && labOrders.length > 0) {
          // If no lab_results data, use lab orders from visit_labs table
          console.log('📊 Including lab orders from visit_labs table:', labOrders.length, 'orders');
          labOrders.forEach(order => {
            // Get test name - ensure it's not too long
            const testName = (order.lab?.name || order.test_name || 'Lab Test');
            const formattedTestName = testName.length > 30 ? testName.substring(0, 27) + '...' : testName;
            const paddedTestName = formattedTestName.padEnd(32);

            // Get observed value with unit
            const observedValue = order.result_value || order.observed_value || order.result || order.value;
            const unit = order.lab?.unit || order.unit || order.result_unit || '';
            const resultText = observedValue ?
              `${observedValue}${unit ? ' ' + unit : ''}` :
              'Pending';
            const formattedResult = resultText.length > 18 ? resultText.substring(0, 15) + '...' : resultText;
            const paddedResult = formattedResult.padEnd(20);

            // Get reference range
            const range = order.lab?.normal_range || order.lab?.reference_range ||
                         order.normal_range || order.reference_range || 'N/A';
            const formattedRange = range.length > 18 ? range.substring(0, 15) + '...' : range;
            const paddedRange = formattedRange.padEnd(20);

            // Get status based on whether we have a value
            const status = observedValue ? '✓ Complete' : '⏳ Pending';

            // Build the row with proper spacing
            labResultsTable += `${paddedTestName}${paddedResult}${paddedRange}${status}\n`;
          });
        } else if (labResultsList.length > 0) {
          // Fallback: use processed lab results list
          labResultsList.forEach(item => {
            labResultsTable += `${item}\n`;
          });
        }
        labResultsTable += '================================================================================\n';
      }

      const summary = `${formatTableField('Name', patientName)} ${formatTableField('Patient ID', patientInfo.patients_id || patient.patients?.patients_id || 'UHAY25I22001')}
${formatTableField('Primary Care Provider', doctorName)} ${formatTableField('Registration ID', patient.patients?.registration_id || 'IH25I22001')}
${formatTableField('Sex / Age', `${patientGender} / ${patientAge} Year`)} ${formatTableField('Mobile No', patientInfo.phone || patient.patients?.phone || 'N/A')}
${formatTableField('Tariff', patient.patients?.tariff || 'Private')} ${formatTableField('Address', patient.patients?.address || 'N/A')}
${formatTableField('Admission Date', visitDate)} ${formatTableField('Visit Date', new Date().toLocaleDateString())}

================================================================================

PRESENT CONDITION
--------------------------------------------------------------------------------
Diagnosis: ${primaryDiagnosis}${secondaryDiagnoses.length > 0 ? `, ${secondaryDiagnoses.join(', ')}` : ''}

${medicationsTable}

CASE SUMMARY:
--------------------------------------------------------------------------------
${complaints && complaints.length > 0 ? wrapText(`The patient was admitted with complaints of ${complaints.join(', ')}.`, 80) : 'The patient was admitted for medical evaluation.'}

Upon thorough examination, vitals were recorded as follows:
- Temperature: 98.6°F
- Pulse Rate: 80/min
- Blood Pressure: 120/80mmHg
- SpO2: 98% in Room Air

Post-examination, treatment was initiated based on clinical findings.

${labResultsTable ? `\n${labResultsTable}` : ''}

${radiologyOrders && radiologyOrders.length > 0 ? `
================================================================================
RADIOLOGY INVESTIGATIONS:
================================================================================
${radiologyOrders.map(r => {
  const testName = r.radiology?.name || r.test_name || 'Radiology Test';
  const findings = r.findings || r.result || 'Results pending';
  const impression = r.impression || '';
  return `• ${testName}: ${findings}${impression ? ` - ${impression}` : ''}`;
}).join('\n')}
================================================================================
` : ''}

${otNote ? `PROCEDURE DETAILS:
================================================================================
${formatTableField('Date and Time', `${new Date().toLocaleDateString()}, 11:00 am`)}
${formatTableField('Procedure', otNote.surgery_name || 'Surgical procedure performed')}
${formatTableField('Surgeon', otNote.surgeon || 'Dr. Surgeon')}
${formatTableField('Anaesthetist', otNote.anaesthetist || 'Dr. Anaesthetist')}
${formatTableField('Anesthesia Type', otNote.anaesthesia || 'General anesthesia')}
${formatTableField('Surgery Description', otNote.procedure_performed || otNote.description || 'The procedure was performed successfully without complications.')}
${otNote.implant ? formatTableField('Implant Used', otNote.implant) + '\n' : ''}================================================================================

` : ''}
The patient responded adequately to the treatment. He/She is recommended to continue the prescribed medication and should observe the following precautions at home:
- Maintain hydration and adequate rest
- Follow prescribed diet restrictions
- Take medications as directed
- Avoid heavy lifting and strenuous activities
- Monitor for any warning signs

The patient should return to the hospital immediately:
- If symptoms worsen or recur
- If experiencing severe pain or discomfort
- If fever persists even after medication
- Any unusual swelling or complications

================================================================================
URGENT CARE/ EMERGENCY CARE IS AVAILABLE 24 X 7.
PLEASE CONTACT: 7030974619, 9373111709.
================================================================================

Disclaimer: The external professional reviewing this case should refer to their
clinical understanding and expertise in managing the care of this patient based
on the diagnosis and details provided.

================================================================================
ADVICE
================================================================================

Advice:
Follow up after 7 days/SOS.

--------------------------------------------------------------------------------
${formatTableField('Review on', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString())}
${formatTableField('Attending Physician', doctorName.includes('Dr.') ? doctorName.replace('Dr. ', '') : doctorName)}
--------------------------------------------------------------------------------

                                        Dr. ${doctorName.includes('Dr.') ? doctorName.replace('Dr. ', '') : doctorName} (Gastroenterologist)

================================================================================
Note: URGENT CARE/ EMERGENCY CARE IS AVAILABLE 24 X 7.
PLEASE CONTACT: 7030974619, 9373111709.
================================================================================
`;

      // Save fetched data to separate panel (not the editor)
      // Include extracted handwritten notes at the top if available
      const fullFetchedData = extractedNotes
        ? `=== EXTRACTED HANDWRITTEN NOTES ===\n${extractedNotes}\n\n=== DATABASE DATA ===\n${summary}`
        : summary;
      setFetchedDataText(fullFetchedData);
      setDataFetched(true);

      // Show success message with accurate data counts
      console.log('📊 Lab results for success message:', {
        labResultsData: labResultsData?.length || 0,
        labOrders: labOrders?.length || 0
      });

      const dataInfo = [];

      // Add diagnosis information first (most important)
      if (visitDiagnosis?.primaryDiagnosis && visitDiagnosis.primaryDiagnosis !== 'No diagnosis recorded') {
        const diagnosisCount = 1 + (visitDiagnosis.secondaryDiagnoses?.length || 0);
        if (diagnosisCount === 1) {
          dataInfo.push(`1 diagnosis (Primary: ${visitDiagnosis.primaryDiagnosis})`);
        } else {
          dataInfo.push(`${diagnosisCount} diagnoses (Primary: ${visitDiagnosis.primaryDiagnosis})`);
        }
      }

      // Prioritize visit_labs (ordered tests from billing page)
      if (visitLabsData && visitLabsData.length > 0) {
        dataInfo.push(`${visitLabsData.length} lab test(s)`);
      } else if (labResultsData && labResultsData.length > 0) {
        dataInfo.push(`${labResultsData.length} lab result(s)`);
      } else if (labOrders && labOrders.length > 0) {
        dataInfo.push(`${labOrders.length} lab order(s)`);
      }
      if (radiologyOrders && radiologyOrders.length > 0) {
        dataInfo.push(`${radiologyOrders.length} radiology test(s)`);
      }
      if (prescriptionData && prescriptionData.length > 0) {
        dataInfo.push(`${prescriptionData.length} prescription(s)`);
      }
      if (otNote) dataInfo.push('OT notes');
      if (complications.length > 0) dataInfo.push(`${complications.length} complication(s)`);

      const message = dataInfo.length > 0
        ? `✅ OPD summary data fetched successfully!\n\nIncluded data:\n• ${dataInfo.join('\n• ')}\n\nTotal characters: ${summary.length}`
        : `✅ OPD summary generated with available database data.\n\nDiagnosis: ${visitDiagnosis ? 'Found' : 'Not found'}\nTotal characters: ${summary.length}`;

      alert(message);

    } catch (error) {
      console.error('Error in handleFetchData:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`❌ Failed to fetch OPD summary data.\n\nError: ${errorMessage}\n\nPlease check the console for detailed information.`);
    } finally {
      setIsFetchingData(false);
      setFetchProgress('');
    }
  };

  // Open AI generation modal with prompt and data editing
  const handleAIGenerate = async () => {
    console.log('🚀 handleAIGenerate started');

    // Declare ALL variables at the very beginning to ensure proper scope
    let existingDiagnosis = ''; // Initialize with empty string first
    let medicationsData = [];

    // Main try block
    try {
      console.log('📝 Initializing AI generation...');

      if (!patient) {
        alert('Please fetch patient data first before generating AI summary.');
        return;
      }

      // Extract existing diagnosis from current discharge summary to preserve it
      const existingContent = dischargeSummaryText || '';
      console.log('📄 Existing content length:', existingContent.length);

      if (existingContent) {
        const diagnosisMatch = existingContent.match(/Diagnosis:\s*([^\n]+)/i);
        if (diagnosisMatch && diagnosisMatch[1]) {
          existingDiagnosis = diagnosisMatch[1].trim();
          console.log('📋 Preserving existing diagnosis:', existingDiagnosis);
        } else {
          console.log('📋 No existing diagnosis found in content');
          existingDiagnosis = ''; // Explicitly set to empty string
        }
      } else {
        existingDiagnosis = ''; // Explicitly set to empty string if no content
      }

    // First ensure we have fetched all required data
    if (!formattedLabResults || formattedLabResults.length === 0 || !complications) {
      await handleFetchData();
    }

    // Fetch medications from visit_medications table
    try {
      const { data: visitData } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitData?.id) {
        // Try to fetch from visit_medications table with JOIN
        const { data: visitMedications, error: medError } = await supabase
          .from('visit_medications')
          .select(`
            *,
            medication:medication_id (
              name,
              description
            )
          `)
          .eq('visit_id', visitData.id)
          .order('created_at', { ascending: true });

        if (visitMedications && visitMedications.length > 0) {
          medicationsData = visitMedications.map(med => {
            // Extract actual medication name from various possible fields
            let medName = '';

            // First check if medication object exists (from JOIN)
            if (med.medication && typeof med.medication === 'object' && med.medication.name) {
              medName = med.medication.name;
            }
            // Otherwise check various possible field names
            else {
              const possibleNameFields = [
                'medication_name', 'name', 'medicine_name',
                'drug_name', 'item_name', 'drug', 'item', 'medicine',
                'med_name', 'product_name', 'generic_name'
              ];

              for (const field of possibleNameFields) {
                if (med[field] && typeof med[field] === 'string' &&
                    med[field] !== 'MEDICATION' && med[field] !== 'N/A') {
                  medName = med[field];
                  break;
                }
              }
            }

            // If still no name, log the available fields
            if (!medName) {
              console.warn('Could not find medication name in visit_medications record.');
              console.warn('Available fields:', Object.keys(med));
              console.warn('Record:', med);
              // Don't use placeholder
              medName = '';
            }

            return {
              name: medName,
              strength: med.dose || med.dosage || med.strength || '',
              route: med.route || 'Oral',
              dosage: med.frequency || 'as directed',
              days: med.duration || med.days || ''
            };
          });
        }
      }
    } catch (error) {
    }

    // Fetch required data that might be missing
    let formattedLabResultsLocal = formattedLabResults;
    let complicationsLocal = complications;
    let abnormalResultsLocal = abnormalResults;

    // If data is not available, try to fetch it
    if (!formattedLabResultsLocal) {
      formattedLabResultsLocal = [];
    }
    if (!complicationsLocal) {
      complicationsLocal = [];
    }
    if (!abnormalResultsLocal) {
      abnormalResultsLocal = [];
    }

    // The diagnosis data is already loaded by useVisitDiagnosis above, and the
    // rest of this file reads it directly (see primaryDiagnosis at ~1046 and
    // complaints at ~1276). This used to re-fetch it from a table called
    // `visit_diagnosis`, which was wrong three times over: no such table exists
    // (the real one is visit_diagnoses), it filtered a uuid column with the
    // printed visit code from the URL, and that table's columns are
    // diagnosis_id/is_primary/notes -- nothing like the shape read below.
    //
    // So it always threw, was always swallowed, and every field below fell
    // through to its default. Complaints, diagnoses, treatment course and
    // condition were blank on every discharge summary.
    const visitDiagnosisLocal = visitDiagnosis;

    // Fetch complete patient data if not available
    let fullPatientData = patient.patients;
    if (!fullPatientData || !fullPatientData.phone || !fullPatientData.address) {
      try {
        const { data: patientData } = await supabase
          .from('patients')
          .select('*')
          .eq('id', patient.patient_id || patient.patients?.id)
          .single();

        if (patientData) {
          fullPatientData = patientData;
        }
      } catch (error) {
      }
    }

    const complaints = visitDiagnosisLocal?.complaints || [patient.reason_for_visit || 'General consultation'];

    // Prepare patient data for editing
    // Use existing diagnosis from the summary if available (to preserve manual edits),
    // otherwise use visitDiagnosisLocal or patient.diagnosis
    const primaryDiagnosis = existingDiagnosis || visitDiagnosisLocal?.primaryDiagnosis || patient.diagnosis || 'No diagnosis recorded';
    const secondaryDiagnoses = visitDiagnosisLocal?.secondaryDiagnoses || [];
    const complicationsData = complicationsLocal || [];
    // Convert medication objects to strings for parseMedication function
    const medications = medicationsData.length > 0
      ? medicationsData.map(med => {
          const name = med.name || 'Medication';
          const strength = med.strength || '';
          const route = med.route || 'Oral';
          const dosage = med.dosage || 'as directed';
          const days = med.days || 'As directed';
          return `${name} ${strength} ${route} ${dosage} ${days}`.trim();
        })
      : [];

    // Fetch OT data, radiology, and lab investigations from database
    let otData = null;
    let radiologyInvestigations = [];
    let labInvestigationsData = [];

    // Fetch OT notes (ALL records for multiple surgeries)
    try {
      const { data: otNotes } = await supabase
        .from('ot_notes')
        .select('*')
        .eq('visit_id', visitId)
        .order('created_at', { ascending: true });

      if (!otNotes || otNotes.length === 0) {
        // Fallback: Try with patient_id
        const { data: otNotes2 } = await supabase
          .from('ot_notes')
          .select('*')
          .eq('patient_id', patient.patient_id || patient.patients?.id)
          .order('created_at', { ascending: true });

        if (otNotes2 && otNotes2.length > 0) {
          // Combine data from all OT notes
          otData = {
            ...otNotes2[0],
            // Collect all implants (filter out empty values)
            implant: otNotes2.map(n => n.implant).filter(Boolean).join(', '),
            // Collect all procedures
            procedure_performed: otNotes2.map(n => n.procedure_performed).filter(Boolean).join(', '),
            // Collect all surgeons (unique)
            surgeon: [...new Set(otNotes2.map(n => n.surgeon).filter(Boolean))].join(', ')
          };
        }
      } else {
        // Combine data from all OT notes
        otData = {
          ...otNotes[0],
          // Collect all implants (filter out empty values)
          implant: otNotes.map(n => n.implant).filter(Boolean).join(', '),
          // Collect all procedures
          procedure_performed: otNotes.map(n => n.procedure_performed).filter(Boolean).join(', '),
          // Collect all surgeons (unique)
          surgeon: [...new Set(otNotes.map(n => n.surgeon).filter(Boolean))].join(', ')
        };
      }
    } catch (error) {
    }

    // Fetch radiology investigations
    try {
      if (patient?.visit_id) {
        const { data: visitData } = await supabase
          .from('visits')
          .select('id')
          .eq('visit_id', visitId)
          .single();

        if (visitData?.id) {
          const { data: radiologyOrders } = await supabase
            .from('visit_radiology')
            .select(`
              *,
              radiology:radiology_id (
                name,
                category
              )
            `)
            .eq('visit_id', visitData.id)
            .order('created_at', { ascending: true });

          if (radiologyOrders && radiologyOrders.length > 0) {
            radiologyInvestigations = radiologyOrders.map(r => ({
              name: r.radiology?.name || 'Unknown Test',
              findings: r.findings || r.result || 'Pending',
              status: r.status || 'Completed'
            }));
          }
        }
      }
    } catch (error) {
    }

    // Process lab investigations - merge visit_labs with lab_results for actual values
    if (visitLabs && visitLabs.length > 0) {
      labInvestigationsData = visitLabs.map(test => {
        const testName = test.test_name || test.lab_name || 'Unknown Test';
        // Check if there's an actual result in lab_results
        let matchedResult: any = null;
        if (labResults && labResults.length > 0) {
          matchedResult = labResults.find((r: any) => r.visit_lab_id === test.id);
          if (!matchedResult) {
            const labName = (test.test_name || test.lab_name || '').toLowerCase();
            matchedResult = labResults.find((r: any) =>
              (r.main_test_name || '').toLowerCase().includes(labName) ||
              labName.includes((r.test_name || '').toLowerCase())
            );
          }
        }
        if (matchedResult && matchedResult.result_value) {
          return {
            name: testName,
            result: `${matchedResult.result_value}${matchedResult.result_unit ? ' ' + matchedResult.result_unit : ''}`,
            range: matchedResult.reference_range || test.description || '-',
            status: matchedResult.is_abnormal ? 'Abnormal' : 'Normal'
          };
        }
        return {
          name: testName,
          result: 'Ordered',
          range: test.description || '-',
          status: 'Pending'
        };
      });
    }
    // ONLY use labResults if visitLabs is empty
    else if (labResults && labResults.length > 0) {
      labInvestigationsData = labResults.map(lab => ({
        name: lab.test_name || lab.main_test_name || 'Unknown Test',
        result: `${lab.result_value || 'Pending'}${lab.result_unit ? ' ' + lab.result_unit : ''}`,
        range: lab.reference_range || 'N/A',
        status: lab.is_abnormal ? 'Abnormal' : 'Normal'
      }));
    }

    const patientData = {
      name: fullPatientData?.name || patient.patients?.name || 'Unknown Patient',
      age: fullPatientData?.age || patient.patients?.age || 'N/A',
      gender: fullPatientData?.gender || patient.patients?.gender || 'N/A',
      visitId: patient.visit_id || 'N/A',
      patientId: fullPatientData?.patients_id || patient.patients?.patients_id || 'N/A',
      uhId: fullPatientData?.patients_id || patient.patients?.patients_id || 'N/A',
      registrationId: fullPatientData?.registration_id || patient.patients?.registration_id || 'N/A',
      mobile: fullPatientData?.phone || patient.patients?.phone || 'N/A',
      mobileNumber: fullPatientData?.phone || patient.patients?.phone || 'N/A',
      address: fullPatientData?.address || patient.patients?.address || 'N/A',
      tariff: fullPatientData?.tariff || patient.patients?.tariff || 'Private',
      admissionDate: patient.admission_date || patient.visit_date || new Date().toLocaleDateString(),
      dischargeDate: patient.discharge_date || new Date().toLocaleDateString(),
      consultant: patient.appointment_with || 'Dr. Unknown',
      primaryDiagnosis,
      secondaryDiagnoses,
      complications: complicationsData,
      medications,
      complaints,
      treatmentCourse: visitDiagnosisLocal?.treatmentCourse || [],
      condition: visitDiagnosisLocal?.condition || [],
      labResults: formattedLabResultsLocal || [],
      abnormalLabResults: abnormalResultsLocal || [],
      labInvestigations: labInvestigationsData,
      radiologyInvestigations,
      otData: otData ? {
        surgeryName: otData.surgery_name || 'Surgical Procedure',
        surgeon: otData.surgeon || 'Attending Surgeon',
        anaesthesia: otData.anaesthesia || 'General Anaesthesia',
        procedurePerformed: otData.procedure_performed || '',
        findings: otData.findings || '',
        description: otData.description || '',
        implant: otData.implant || ''
      } : null,
      vitalSigns: visitDiagnosisLocal?.vitalSigns || [],
      clinicalHistory: visitDiagnosisLocal?.clinicalHistory || '',
      examinationFindings: visitDiagnosisLocal?.examinationFindings || ''
    };

    // Set editable data
    setEditablePatientData(patientData);

    // Build medications section from actual data only (no dummy data)
    const medsSection = (() => {
      if (!patientData.medications || patientData.medications.length === 0) {
        return 'Medications Prescribed: None recorded in database';
      }
      const medsLines = patientData.medications.map(med => {
        const parsed = parseMedication(med);
        return `* ${parsed.name} ${parsed.strength} | ${parsed.route} | ${parsed.dosage} | ${parsed.days}`;
      }).join('\n');
      return `Medications Prescribed:\n${medsLines}`;
    })();

    // Build lab section
    const labSection = (() => {
      if (!patientData.labInvestigations || patientData.labInvestigations.length === 0) return '';
      const lines = patientData.labInvestigations.map(lab => {
        const statusIcon = lab.status === 'Pending' ? '⏳ Pending' : (lab.status === 'Abnormal' ? '⚠ Abnormal' : '✓ Normal');
        return `  ${lab.name}: ${lab.result} (Ref: ${lab.range}) - ${statusIcon}`;
      }).join('\n');
      return `Lab Investigations:\n${lines}`;
    })();

    // Build radiology section
    const radiologySection = (() => {
      if (!patientData.radiologyInvestigations || patientData.radiologyInvestigations.length === 0) return '';
      const lines = patientData.radiologyInvestigations.map(rad =>
        `  ${rad.name}: ${rad.findings} - ${rad.status}`
      ).join('\n');
      return `Radiology Investigations:\n${lines}`;
    })();

    // Build OT section
    const otSection = patientData.otData ? `
Surgical Details:
  Surgery: ${patientData.otData.surgeryName}
  Surgeon: ${patientData.otData.surgeon}
  Anaesthesia: ${patientData.otData.anaesthesia}
  Procedure: ${patientData.otData.procedurePerformed}
  Findings: ${patientData.otData.findings || 'N/A'}
  Post-op Notes: ${patientData.otData.description || 'N/A'}
  ${patientData.otData.implant ? `Implant: ${patientData.otData.implant}` : ''}` : '';

    // Build vitals section
    const vitalsSection = patientData.vitalSigns && patientData.vitalSigns.length > 0
      ? `Vital Signs:\n${patientData.vitalSigns.join('\n')}`
      : '';

    // Clean consultant name - remove duplicate "Dr." prefix
    const cleanConsultant = (patientData.consultant || 'N/A').replace(/^Dr\.\s*Dr\./i, 'Dr.');

    // Prepare comprehensive prompt with all medical data
    const prompt = `You are a senior medical documentation specialist. Generate a professional, clinical OPD (Out-Patient Department) Summary based STRICTLY on the data provided below. Do NOT invent or hallucinate any clinical information. If data is missing, write "Not recorded" — never fabricate vitals, medications, or findings.

RULES:
1. Use ONLY the data provided below. Do not add generic/template vitals, medications, or advice.
2. If medications are not available, state "Medications: As per prescription. Please refer to dispensed prescription slip."
3. If handwritten notes contain unclear text, mark it as "[unclear from handwritten notes]" — do NOT guess.
4. Keep the summary concise and professional. No excessive boilerplate.
5. Use the exact lab values provided — show actual results, not "Ordered/Pending" if values are available.
6. For advice section, generate specific advice based on the diagnosis, not generic precautions.

=== PATIENT DEMOGRAPHICS ===
Name: ${patientData.name}
Sex / Age: ${patientData.gender} / ${patientData.age} Year
Patient ID: ${patientData.uhId || patientData.patientId || 'N/A'}
Registration ID: ${patientData.registrationId || 'N/A'}
Mobile: ${patientData.mobileNumber || patientData.mobile || 'N/A'}
Address: ${patientData.address || 'N/A'}
Tariff: ${patientData.tariff || 'N/A'}
Visit Date: ${patientData.admissionDate || 'N/A'}
Primary Care Provider: ${cleanConsultant}

=== CLINICAL DATA ===
Primary Diagnosis: ${patientData.primaryDiagnosis || 'Not recorded'}
Secondary Diagnoses: ${patientData.secondaryDiagnoses.join(', ') || 'None'}
Chief Complaints: ${patientData.complaints.join(', ') || 'Not recorded'}
Complications: ${patientData.complications.join(', ') || 'None'}
${vitalsSection ? `\n${vitalsSection}` : ''}
${patientData.clinicalHistory ? `\nClinical History: ${patientData.clinicalHistory}` : ''}
${patientData.examinationFindings ? `\nExamination Findings: ${patientData.examinationFindings}` : ''}

=== INVESTIGATIONS ===
${labSection || 'Lab Investigations: None ordered'}
${radiologySection || ''}
${otSection || ''}

=== MEDICATIONS ===
${medsSection}

${patientData.treatmentCourse && patientData.treatmentCourse.length > 0 ? `=== TREATMENT COURSE ===\n${patientData.treatmentCourse.join('\n')}` : ''}

=== OUTPUT FORMAT ===
Generate the OPD Summary in this exact structure:

OPD SUMMARY
================================================================================

Name                  : ${(patientData.name || '').padEnd(30)}Patient ID            : ${patientData.uhId || patientData.patientId || 'N/A'}
Primary Care Provider : ${cleanConsultant.padEnd(30)}Registration ID       : ${patientData.registrationId || 'N/A'}
Sex / Age             : ${((patientData.gender || '') + ' / ' + (patientData.age || '') + ' Year').padEnd(30)}Mobile No             : ${patientData.mobileNumber || patientData.mobile || 'N/A'}
Tariff                : ${(patientData.tariff || '').padEnd(30)}Address               : ${patientData.address || 'N/A'}
Admission Date        : ${(patientData.admissionDate || '').padEnd(30)}Visit Date            : ${patientData.dischargeDate || ''}

================================================================================

Then include these sections (only include sections where data is available):
1. Present Condition & Diagnosis
2. Chief Complaints (use actual complaints, not generic text)
3. Vital Signs (ONLY if recorded — do NOT invent default values)
4. Investigations (Lab + Radiology with actual values)
5. Surgical Details (only if OT data exists)
6. Medications Prescribed — MUST be in a markdown table format:
   | Medication Name | Strength | Route | Dosage | Duration |
   Use actual medications from the data. If none available, state "As per prescription. Please refer to dispensed prescription slip."
7. Case Summary (2-3 sentences summarizing the visit based on actual data)
8. Condition at Visit (based on actual clinical data)
9. Advice (specific to the diagnosis — not generic boilerplate)
10. Follow-up Date and Attending Physician

Footer:
Review on: ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB')}
Attending Physician: ${cleanConsultant}
Emergency Contact: 7030974619, 9373111709

IMPORTANT: Output plain text only. Be professional and concise. Include ALL provided data. Do NOT fabricate any information not provided above.`;

      // Include fetched database data and extracted handwritten notes in the prompt
      let promptText = prompt;
      if (fetchedDataText) {
        promptText = `FETCHED DATABASE DATA:\n${fetchedDataText}\n\n---\n\n${promptText}`;
      }
      if (extractedNotes) {
        promptText = `IMPORTANT - EXTRACTED HANDWRITTEN NOTES FROM DOCTOR:\n${extractedNotes}\n\n---\n\nUse the above handwritten notes as the PRIMARY source of clinical information. Combine with the fetched database data below to generate a complete OPD summary.\n\n${promptText}`;
      }

      setEditablePrompt(promptText);
      setShowGenerationModal(true);
    } catch (error) {
      console.error('💥 Error in AI generation setup:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error details:', {
        error: errorMsg,
        stack: error instanceof Error ? error.stack : 'No stack trace',
        patient: patient ? 'Available' : 'Not available',
        visitId: visitId || 'Not available',
        medicationsData: medicationsData?.length || 0
      });
      alert(`Error setting up AI generation.\n\nError: ${errorMsg}\n\nPlease check the console for details.`);
    }
  };

  // ---------------------------------------------------------------------------
  // Camera & OCR Functions
  // ---------------------------------------------------------------------------

  const startCamera = async () => {
    try {
      setShowCameraDialog(true);
      setIsCapturing(true);
      setCapturedImage(null);

      // Small delay to ensure dialog is mounted
      setTimeout(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              videoRef.current?.play().catch(() => {});
            };
          }
        } catch (err) {
          console.error('Camera access error:', err);
          toast({
            title: 'Camera Error',
            description: 'Unable to access camera. Please check permissions.',
            variant: 'destructive',
          });
          setShowCameraDialog(false);
          setIsCapturing(false);
        }
      }, 300);
    } catch (err) {
      console.error('Camera error:', err);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const result = await captureInAppPhoto(videoRef.current, canvasRef.current);
    if (!result) {
      toast({
        title: 'Camera loading',
        description: 'Camera is still loading. Please try again.',
        variant: 'destructive',
      });
      return;
    }

    capturedBlobRef.current = result.blob;
    setCapturedGeo(result.geo);
    setCapturedImage(URL.createObjectURL(result.blob));
    stopCamera();
  };

  const retryCapturedGps = async () => {
    if (!capturedBlobRef.current) return;
    setGpsRetryLoading(true);
    try {
      const geo = await captureGeolocation();
      const updatedBlob = await reapplyGeotagToBlob(capturedBlobRef.current, geo);
      capturedBlobRef.current = updatedBlob;
      setCapturedGeo(geo);
      setCapturedImage(URL.createObjectURL(updatedBlob));
    } finally {
      setGpsRetryLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast({
        title: 'Invalid file',
        description: 'Please upload an image (JPEG, PNG) or PDF file.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Maximum file size is 10 MB.',
        variant: 'destructive',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCapturedImage(dataUrl);
      setShowCameraDialog(true);
    };
    reader.readAsDataURL(file);

    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const processImageWithOCR = async (imageDataUrl: string) => {
    try {
      setIsProcessingOCR(true);

      // Downscale before encoding to keep vision token cost in check.
      const sourceBlob = await (await fetch(imageDataUrl)).blob();
      const { base64: base64Data, mimeType } = await downscaleImageForVision(sourceBlob);

      const patientName = patient?.patients?.name || 'Unknown';
      const patientId = patient?.visit_id || 'Unknown';
      const doctor = patient?.appointment_with || 'Unknown';

      const ocrPrompt = `You are a medical document OCR specialist. This is a photo of a handwritten OPD (Outpatient Department) summary for patient "${patientName}" (ID: ${patientId}), attending doctor: Dr. ${doctor}.

Please carefully read and transcribe ALL handwritten text from this image. Structure the output as a proper OPD summary with the following sections (include only sections that are present in the handwriting):

- Chief Complaints
- History of Present Illness
- Past History
- Examination Findings / Vitals
- Diagnosis / Provisional Diagnosis
- Investigations (Lab tests, X-ray, ECG, etc.)
- Treatment Given / Medications Prescribed
- Procedures Done
- Condition at Visit
- Follow-up Instructions
- Advice

IMPORTANT:
- Transcribe the handwritten content as accurately as possible
- Use proper medical terminology
- If something is unclear, write it with [unclear] notation
- Format medications as: Drug Name - Strength - Route - Dosage - Duration
- Keep the formatting clean with bullet points where appropriate
- Do NOT add information that is not in the handwritten document
- Output ONLY the transcribed and structured text, no explanations`;

      let extractedText: string;
      if (LLM_BACKEND === 'vps') {
        // Vision on VPS Claude Opus (subscription auth). No fallback: errors throw.
        extractedText = (await callVpsClaude(ocrPrompt, 'opus', [{ base64: base64Data, mimeType }])) || '';
      } else {
        const requestBody = {
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                }
              },
              {
                text: ocrPrompt
              }
            ]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4000
          }
        };

        const response = await geminiGenerateContent(
          geminiGenerateContentUrl(''),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(`Gemini API error: ${response.status} - ${errorData?.error?.message || response.statusText}`);
        }

        const data = await response.json();
        extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      if (!extractedText) {
        toast({
          title: 'No text detected',
          description: 'Could not extract any text from the image. Please try again with a clearer image.',
          variant: 'destructive',
        });
        return;
      }

      // Save extracted text to dedicated panel
      setExtractedNotes(extractedText);

      // Also populate the editor
      if (dischargeSummaryText.trim()) {
        const currentText = dischargeSummaryText;
        setDischargeSummaryText(currentText + '\n\n--- Extracted from Handwritten Notes ---\n\n' + extractedText);
      } else {
        setDischargeSummaryText(extractedText);
      }

      toast({
        title: 'Text extracted successfully',
        description: 'Handwritten OPD summary has been processed and added to the editor.',
      });

      // Close the dialog
      setShowCameraDialog(false);
      setCapturedImage(null);

    } catch (error) {
      console.error('OCR processing error:', error);
      toast({
        title: 'OCR Processing Failed',
        description: error instanceof Error ? error.message : 'Failed to process image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessingOCR(false);
    }
  };

  const closeCameraDialog = () => {
    stopCamera();
    setShowCameraDialog(false);
    setCapturedImage(null);
    setCapturedGeo(null);
    capturedBlobRef.current = null;
    setGpsRetryLoading(false);
    setIsProcessingOCR(false);
  };

  // Actual AI generation function
  const generateAISummary = async () => {
    try {
      setIsGenerating(true);
      setShowGenerationModal(false);

      // The diagnosis already typed into the summary, read the same way
      // handleAIGenerate reads it, so the closing message can say truthfully
      // whether it survived the regeneration.
      const existingDiagnosis = (dischargeSummaryText || '').match(/Diagnosis:\s*([^\n]+)/i)?.[1]?.trim() || '';

      console.log('🤖 Generating AI discharge summary with edited data:', editablePatientData);
      console.log('🤖 Using edited prompt:', editablePrompt);

      console.log('🔍 API Request Details:');

      // Comprehensive medical discharge summary request
      const systemPrompt = 'You are an expert medical professional specializing in creating comprehensive OPD summaries for hospitals. Generate detailed, professional medical documentation following Indian medical standards and terminology. Include ALL provided medical data including investigations, lab results, radiology findings, OT notes, and complications.';

      let aiResponse: string;
      if (LLM_BACKEND === 'vps') {
        // Clinical discharge-summary generation on VPS Claude Opus (matches the
        // IpdDischargeSummary text generations). No fallback: errors throw.
        aiResponse = (await callVpsClaude(systemPrompt + '\n\n' + editablePrompt, 'opus')) || '';
      } else {
        const requestBody = {
          contents: [{
            parts: [{
              text: systemPrompt + '\n\n' + editablePrompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4000
          }
        };

        console.log('🔍 Request body:', JSON.stringify(requestBody, null, 2));

        // Call Google Gemini API
        const response = await geminiGenerateContent(geminiGenerateContentUrl(''), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        console.log('📡 API Response received:');

        if (!response.ok) {
          // Try to get error details from response
          let errorDetails = 'Unknown error';
          try {
            const errorData = await response.json();
            errorDetails = JSON.stringify(errorData, null, 2);
            console.error('🚨 API Error Response:', errorData);
          } catch (parseError) {
            console.error('🚨 Could not parse error response:', parseError);
            errorDetails = await response.text();
          }

          throw new Error(`Gemini API error: ${response.status} - ${response.statusText}\nDetails: ${errorDetails}`);
        }

        const data = await response.json();
        console.log('✅ API Response data structure:', {
          candidates: data.candidates?.length,
          hasContent: !!data.candidates?.[0]?.content?.parts?.[0]?.text,
          usageMetadata: data.usageMetadata
        });
        // Get AI response content (Gemini format)
        aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
      console.log('🤖 AI Response received:', aiResponse ? aiResponse.substring(0, 200) + '...' : 'No content');

      // Check if AI response is properly formatted
      let aiGeneratedSummary;

      // Additional validation: check if AI response contains prompt echo or technical fields
      const hasPromptEcho = aiResponse && (
        aiResponse.includes('PATIENT DATA PROVIDED:') ||
        aiResponse.includes('**Patient Information:**')
      );

      if (hasPromptEcho) {
        console.log('🚨 AI response contains prompt echo - using fallback template');
        aiGeneratedSummary = null; // Force fallback
      } else if (aiResponse && (aiResponse.includes('DISCHARGE SUMMARY') || aiResponse.includes('OPD SUMMARY') || aiResponse.includes('Diagnosis:'))) {
        // AI returned proper plain text format
        aiGeneratedSummary = aiResponse;
      } else {
        aiGeneratedSummary = null; // Force fallback for invalid content
      }

      // Generate fallback template if needed
      if (!aiGeneratedSummary) {
        aiGeneratedSummary = `OPD SUMMARY
================================================================================

Name                  : ${(editablePatientData.name || 'Patient Name').padEnd(30)}Patient ID            : ${editablePatientData.uhId || editablePatientData.patientId || 'UHAY25I22001'}
Primary Care Provider : ${(editablePatientData.consultant || 'Dr. Unknown').padEnd(30)}Registration ID       : ${editablePatientData.registrationId || 'IH25I22001'}
Sex / Age             : ${((editablePatientData.gender || 'Gender') + ' / ' + (editablePatientData.age || 'Age') + ' Year').padEnd(30)}Mobile No             : ${editablePatientData.mobileNumber || editablePatientData.mobile || 'N/A'}
Tariff                : ${(editablePatientData.tariff || 'Private').padEnd(30)}Address               : ${editablePatientData.address || 'N/A'}
Admission Date        : ${(editablePatientData.admissionDate || new Date().toLocaleDateString()).padEnd(30)}Visit Date            : ${editablePatientData.dischargeDate || new Date().toLocaleDateString()}

================================================================================

Present Condition

Diagnosis: ${editablePatientData.primaryDiagnosis || 'Primary diagnosis'}${editablePatientData.secondaryDiagnoses?.length > 0 ? `, ${editablePatientData.secondaryDiagnoses.join(', ')}` : ''}

${editablePatientData.labInvestigations && editablePatientData.labInvestigations.length > 0 ? `Investigations:
--------------------------------------------------------------------------------
LAB INVESTIGATIONS:
Name                              Result                  Range              Status
--------------------------------------------------------------------------------
${editablePatientData.labInvestigations.map(lab => {
  const name = (lab.name || 'Unknown Test').substring(0, 35).padEnd(35);
  const result = (lab.result || 'Pending').substring(0, 24).padEnd(24);
  const range = (lab.range || 'N/A').substring(0, 19).padEnd(19);
  const status = lab.status || 'Normal';
  return `${name}${result}${range}${status}`;
}).join('\n')}

` : ''}${editablePatientData.radiologyInvestigations && editablePatientData.radiologyInvestigations.length > 0 ? `RADIOLOGY INVESTIGATIONS:
Name                              Findings                                   Status
--------------------------------------------------------------------------------
${editablePatientData.radiologyInvestigations.map(rad => {
  const name = (rad.name || 'Unknown Test').substring(0, 35).padEnd(35);
  const findings = (rad.findings || 'Pending').substring(0, 43).padEnd(43);
  const status = rad.status || 'Completed';
  return `${name}${findings}${status}`;
}).join('\n')}

` : ''}Medications Prescribed:
--------------------------------------------------------------------------------
Name                     Strength    Route     Dosage                          Days
--------------------------------------------------------------------------------
${(() => {
  const medsToUse = editablePatientData.medications && editablePatientData.medications.length > 0
    ? editablePatientData.medications
    : [
        'Paracetamol 500mg oral twice-daily 5days',
        'Amoxicillin 250mg oral thrice-daily 7days',
        'Omeprazole 20mg oral once-daily 10days',
        'Vitamin-C 500mg oral once-daily 30days',
        'Diclofenac 50mg oral twice-daily 3days'
      ];
  return medsToUse.map(med => {
    const parsed = parseMedication(med);
    const name = parsed.name.padEnd(24);
    const strength = parsed.strength.padEnd(11);
    const route = parsed.route.padEnd(9);
    const dosage = parsed.dosage.padEnd(31);
    const days = parsed.days;
    return `${name} ${strength} ${route} ${dosage} ${days}`;
  }).join('\n');
})()}

Case Summary:

${editablePatientData.complaints && editablePatientData.complaints.length > 0
  ? `The patient was admitted with complaints of ${editablePatientData.complaints.join(', ')}.`
  : 'The patient was admitted for medical evaluation.'}

${editablePatientData.otData ? `
================================================================================
SURGICAL DETAILS:
================================================================================
${formatTableField('Surgery Name', editablePatientData.otData.surgeryName)}
${formatTableField('Surgeon', editablePatientData.otData.surgeon)}
${formatTableField('Anaesthesia', editablePatientData.otData.anaesthesia)}
${formatTableField('Procedure performed', editablePatientData.otData.procedurePerformed || 'As per surgical records')}
${formatTableField('Intraoperative findings', editablePatientData.otData.findings || 'As documented')}
${formatTableField('Post-operative notes', editablePatientData.otData.description || 'Recovery was satisfactory')}
${editablePatientData.otData.implant ? formatTableField('Implant used', editablePatientData.otData.implant) : ''}
================================================================================
` : ''}

${editablePatientData.vitalSigns && editablePatientData.vitalSigns.length > 0 ? `VITAL SIGNS:
${editablePatientData.vitalSigns.join('\n')}
` : `Upon thorough examination, vitals were recorded as follows:
- Temperature: 98.6°F
- Pulse Rate: 80/min
- Blood Pressure: 120/80mmHg
- SpO2: 98% in Room Air`}

${editablePatientData.treatmentCourse && editablePatientData.treatmentCourse.length > 0 ? `TREATMENT COURSE:
${editablePatientData.treatmentCourse.join('\n')}
` : 'Post-examination, appropriate treatment was initiated. The patient responded adequately to the treatment.'}

${editablePatientData.complications && editablePatientData.complications.length > 0 ? `COMPLICATIONS DURING STAY:
${editablePatientData.complications.join(', ')}
` : ''}

The patient is recommended to continue the prescribed medication and should observe the following precautions at home:
- Maintain adequate hydration and rest
- Follow prescribed diet restrictions
- Take medications as directed
- Avoid strenuous activities
- Monitor for any warning signs

The patient should return to the hospital immediately:
- If symptoms worsen or recur
- If experiencing severe pain or discomfort
- If fever persists even after medication
- Any unusual complications

ADVICE

Advice:
Follow up after 7 days/SOS.

--------------------------------------------------------------------------------
Review on                     : ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB')}
Attending Physician            : ${editablePatientData.consultant || 'Sachin Gathibandhe'}
--------------------------------------------------------------------------------

                                           ${editablePatientData.consultant || 'Dr. Dr. Nikhil Khobragade (Gastroenterologist)'}

URGENT CARE/ EMERGENCY CARE IS AVAILABLE 24 X 7. PLEASE CONTACT: 7030974619, 9373111709.
`;
      }

      // AI response should already be in plain text, but convert if it contains HTML
      const finalSummary = aiGeneratedSummary.includes('<') && aiGeneratedSummary.includes('>')
        ? htmlToPlainText(aiGeneratedSummary)
        : aiGeneratedSummary;

      // Preserve existing diagnosis if it was manually edited
      // The AI-generated content already includes the preserved diagnosis in primaryDiagnosis variable
      // so the finalSummary should already have the correct diagnosis
      setDischargeSummaryText(finalSummary);

      const diagnosisWasPreserved = existingDiagnosis.length > 0 && finalSummary.includes(existingDiagnosis);
      const preservedMessage = diagnosisWasPreserved
        ? '✅ AI-powered OPD summary generated successfully! Your existing diagnosis has been preserved.'
        : '✅ AI-powered OPD summary generated successfully using edited patient data!';
      alert(preservedMessage);

    } catch (error) {
      console.error('🚨 DETAILED ERROR ANALYSIS:');
      console.error('- Error object:', error);
      console.error('- Error message:', error.message);
      console.error('- Error stack:', error.stack);

      // Try to get more details about the fetch error
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error('🌐 Network/CORS error detected');
      }

      alert(`❌ Failed to generate AI summary.\n\nError Details:\n${error.message}\n\nCheck console for full details.`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle print - Create dedicated print window with clean HTML
  const handlePrint = () => {
    if (!dischargeSummaryText.trim()) {
      alert('No OPD summary content available to print. Please generate or enter content first.');
      return;
    }

    try {
      console.log('🖨️ Printing discharge summary...');
      console.log('📄 Content length:', dischargeSummaryText.length);
      console.log('📄 Content preview (first 500 chars):', dischargeSummaryText.substring(0, 500));

      // Check if content is HTML or text
      const isHtmlContent = dischargeSummaryText.includes('<div') && dischargeSummaryText.includes('</div>');
      console.log('📄 Content type:', isHtmlContent ? 'HTML' : 'Plain text');

      if (!isHtmlContent) {
        console.log('🚨 WARNING: Content is not HTML format - this may cause display issues');
      }

      // Format content for printing
      let formattedContent = '';

      // Parse the plain text content and format it for HTML printing
      if (!isHtmlContent) {
        console.log('🔧 Content is plain text - formatting for print with all sections');

        // Convert plain text to HTML while preserving all content and formatting
        const lines = dischargeSummaryText.split('\n');
        let htmlContent = [];
        let currentTable = null;
        let inTable = false;
        let tableHeaders = [];
        let tableRows = [];
        let inPatientDetails = false;
        let patientDetailsData = [];
        let inDischargeMedications = false;
        let dischargeMedicationsData = [];
        // Track whether we're in a section to skip (duplicate patient/surgery info from AI)
        const skipRef = { skip: false };

        lines.forEach((line, index) => {
          // Check if we're entering patient details section
          if (line.includes('Patient Details') || line.includes('DISCHARGE SUMMARY') || line.includes('OPD SUMMARY')) {
            if (line.includes('DISCHARGE SUMMARY') || line.includes('OPD SUMMARY')) {
              // Add the OPD summary header
              htmlContent.push(`<h1 style="text-align: center; font-size: 16pt; font-weight: bold; margin: 20px 0; border-bottom: 2px solid #000; padding-bottom: 10px;">OPD SUMMARY</h1>`);
              inPatientDetails = true;
              patientDetailsData = [];
              return; // Skip processing this line further to avoid duplicate
            }
            inPatientDetails = true;
            patientDetailsData = [];
          }

          // Collect patient details data if we're in that section
          if (inPatientDetails && line.includes(':') && !line.includes('PRESENT CONDITION') && !line.includes('Present Condition')) {
            // Parse patient details lines that contain colon-separated key-value pairs
            if (line.includes('Name') || line.includes('Patient ID') || line.includes('Primary Care Provider') ||
                line.includes('Registration ID') || line.includes('Sex / Age') || line.includes('Mobile No') ||
                line.includes('Tariff') || line.includes('Address') || line.includes('Admission Date') ||
                line.includes('Visit Date') || line.includes('Discharge Date')) {
              patientDetailsData.push(line);
              return; // Don't process this line further, it's being collected for the table
            }
          }

          // Check if we're leaving patient details section (when we hit Present Condition or other sections)
          if (inPatientDetails && (line.includes('PRESENT CONDITION') || line.includes('Present Condition') ||
              line.includes('Investigations:') || line.includes('INVESTIGATIONS:'))) {
            // Format and output collected patient details
            if (patientDetailsData.length > 0) {
              htmlContent.push(formatPatientDetailsTable(patientDetailsData));
              patientDetailsData = [];
            }
            inPatientDetails = false;
          }

          // Handle section separators
          if (line.includes('================================================================================')) {
            // If we were collecting patient details, output them now
            if (inPatientDetails && patientDetailsData.length > 0) {
              htmlContent.push(formatPatientDetailsTable(patientDetailsData));
              patientDetailsData = [];
              inPatientDetails = false;
            }
            if (inTable && tableRows.length > 0) {
              // Close any open table
              htmlContent.push(createTableHTML(tableHeaders, tableRows));
              inTable = false;
              tableRows = [];
              tableHeaders = [];
            }
            // Don't add any horizontal line - just skip the separator
            return;
          }

          if (line.includes('--------------------------------------------------------------------------------')) {
            if (inTable && tableRows.length > 0) {
              // This might be a table separator
              return;
            }
            // Don't add any horizontal line - just skip the separator
            return;
          }

          // Detect major section headers
          if (line.match(/^(PRESENT CONDITION|CASE SUMMARY|ADVICE|PROCEDURE DETAILS|LABORATORY INVESTIGATIONS|SURGICAL DETAILS|COMPLICATIONS|TREATMENT COURSE|VITAL SIGNS)/)) {
            if (inTable && tableRows.length > 0) {
              htmlContent.push(createTableHTML(tableHeaders, tableRows));
              inTable = false;
              tableRows = [];
              tableHeaders = [];
            }
            htmlContent.push(`<h2 style="font-size: 11pt; font-weight: bold; margin: 20px 0 10px 0; border-bottom: 2px solid #000; padding-bottom: 5px;">${line}</h2>`);
            return;
          }

          // Detect markdown table rows (| col1 | col2 | col3 |)
          if (line.trim().startsWith('|') && line.trim().endsWith('|') && line.includes('|')) {
            // Skip separator rows (|---|---| or |:---|:---|)
            if (line.replace(/[\s|:\-]/g, '').length === 0) {
              return; // skip separator line
            }
            const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
            if (!inTable) {
              // First row = header
              inTable = true;
              tableHeaders = cells;
            } else {
              tableRows.push(cells.join('\t')); // store as tab-separated for createTableHTML
            }
            return;
          }
          // If we were in a markdown table and hit a non-table line, flush the table
          if (inTable && tableHeaders.length > 0 && !line.trim().startsWith('|')) {
            if (tableRows.length > 0) {
              // Reconstruct rows for createTableHTML: convert tab-separated back to array
              const parsedRows = tableRows.map(r => r.split('\t'));
              let tableHTML = '<table style="width: 100%; border-collapse: collapse; margin: 15px 0;">';
              tableHTML += '<thead><tr>';
              tableHeaders.forEach(h => {
                tableHTML += `<th style="border: 1px solid #000; padding: 8px; background-color: #f0f0f0; font-weight: bold;">${h}</th>`;
              });
              tableHTML += '</tr></thead><tbody>';
              parsedRows.forEach(rowCells => {
                tableHTML += '<tr>';
                rowCells.forEach(cell => {
                  tableHTML += `<td style="border: 1px solid #000; padding: 8px;">${cell || '&nbsp;'}</td>`;
                });
                tableHTML += '</tr>';
              });
              tableHTML += '</tbody></table>';
              htmlContent.push(tableHTML);
            }
            inTable = false;
            tableRows = [];
            tableHeaders = [];
            // Don't return — continue processing this line normally
          }

          // Detect table headers (lines with multiple columns separated by spaces)
          // Make sure it's actually a medication table header, not just any line with "Name"
          if (line.includes('Name') && line.includes('Strength') && line.includes('Route') &&
              line.includes('Dosage') && !line.includes('Case Summary')) {
            // Medications table header
            inTable = true;
            tableHeaders = ['Name', 'Strength', 'Route', 'Dosage', 'Number of Days to be taken'];
            return;
          } else if (line.includes('Test Name') && line.includes('Result') && line.includes('Reference Range')) {
            // Lab results table header
            inTable = true;
            tableHeaders = ['Test Name', 'Result', 'Reference Range', 'Status'];
            return;
          } else if (line.includes('Review on') || line.includes('Attending Physician') || line.includes('Resident On Discharge')) {
            // Review table
            const parts = line.split(':');
            if (parts.length === 2) {
              htmlContent.push(`<div style="margin: 10px 0;"><strong>${parts[0].trim()}:</strong> ${parts[1].trim()}</div>`);
            }
            return;
          }

          // Handle table rows
          if (inTable) {
            if (line.trim() === '' || line.startsWith('ADVICE') || line.includes('URGENT CARE') ||
                line.startsWith('Case Summary') || line.startsWith('CASE SUMMARY')) {
              // End of table
              if (tableRows.length > 0) {
                htmlContent.push(createTableHTML(tableHeaders, tableRows));
              }
              inTable = false;
              tableRows = [];
              tableHeaders = [];
              if (line.trim() !== '') {
                // Process this line normally
                processNormalLine(line, htmlContent, skipRef);
              }
            } else if (!line.includes('------')) {
              // Add table row (skip separator lines)
              tableRows.push(line);
            }
            return;
          }

          // Check if we're entering medications section
          if (line.includes('DISCHARGE MEDICATIONS:') || (line.includes('DISCHARGE') && line.includes('MEDICATIONS')) ||
              line.includes('MEDICATIONS ON DISCHARGE:') || line.includes('Medications Prescribed:') ||
              (line.includes('Medications') && line.includes('Discharge'))) {
            inDischargeMedications = true;
            dischargeMedicationsData = [];
            // Don't add the heading here - it will be included in the table
            return;
          }

          // Collect discharge medications data if we're in that section
          if (inDischargeMedications) {
            // Check if we're leaving the medications section
            if (line.includes('DISCHARGE ADVICE') || line.includes('REVIEW') || line.includes('Return immediately if') ||
                line.includes('Case Summary') || line.includes('CASE SUMMARY') || line.includes('SURGICAL DETAILS') ||
                line.includes('The patient was admitted') || line.includes('ADVICE') ||
                (line.trim() === '' && dischargeMedicationsData.length > 0)) {
              // Format and output collected medications only if we have valid data
              if (dischargeMedicationsData.length > 0) {
                htmlContent.push(formatMedicationsTable(dischargeMedicationsData));
                dischargeMedicationsData = [];
              }
              inDischargeMedications = false;
              // Process this line normally if it's not empty
              if (line.trim() !== '') {
                processNormalLine(line, htmlContent, skipRef);
              }
              return;
            }

            // Collect medication lines (format: "• MedicationName: Dosage" or "- MedicationName: Dosage" or just "MedicationName: Dosage")
            if (line.trim() && !line.includes('-----')) {
              // Remove bullet points or dashes if present
              let medLine = line.trim();
              if (medLine.startsWith('•') || medLine.startsWith('-') || medLine.startsWith('*')) {
                medLine = medLine.substring(1).trim();
              }
              // Only add if it contains medication info (has a colon) and is not a section header
              if (medLine.includes(':') && !medLine.includes('Case Summary') && !medLine.includes('CASE SUMMARY')) {
                dischargeMedicationsData.push(medLine);
              }
            }
            return;
          }

          // Process normal lines
          processNormalLine(line, htmlContent, skipRef);
        });

        // Close any remaining table (could be markdown pipe-table or old format)
        if (inTable && tableRows.length > 0) {
          // Check if rows are tab-separated (from markdown table parsing)
          if (tableRows[0] && tableRows[0].includes('\t')) {
            const parsedRows = tableRows.map(r => r.split('\t'));
            let tableHTML = '<table style="width: 100%; border-collapse: collapse; margin: 15px 0;">';
            tableHTML += '<thead><tr>';
            tableHeaders.forEach(h => {
              tableHTML += `<th style="border: 1px solid #000; padding: 8px; background-color: #f0f0f0; font-weight: bold;">${h}</th>`;
            });
            tableHTML += '</tr></thead><tbody>';
            parsedRows.forEach(rowCells => {
              tableHTML += '<tr>';
              rowCells.forEach(cell => {
                tableHTML += `<td style="border: 1px solid #000; padding: 8px;">${cell || '&nbsp;'}</td>`;
              });
              tableHTML += '</tr>';
            });
            tableHTML += '</tbody></table>';
            htmlContent.push(tableHTML);
          } else {
            htmlContent.push(createTableHTML(tableHeaders, tableRows));
          }
        }

        // If we ended with medications section still open, output the table
        if (inDischargeMedications && dischargeMedicationsData.length > 0) {
          htmlContent.push(formatMedicationsTable(dischargeMedicationsData));
        }

        // Helper function to create table HTML
        function createTableHTML(headers, rows) {
          let tableHTML = '<table style="width: 100%; border-collapse: collapse; margin: 15px 0;">';

          // Add headers if available
          if (headers.length > 0) {
            tableHTML += '<thead><tr>';
            headers.forEach(header => {
              tableHTML += `<th style="border: 1px solid #000; padding: 8px; background-color: #f0f0f0; font-weight: bold;">${header}</th>`;
            });
            tableHTML += '</tr></thead>';
          }

          // Add rows
          tableHTML += '<tbody>';
          rows.forEach(row => {
            if (row.includes('As per prescription')) {
              tableHTML += `<tr><td colspan="${headers.length || 5}" style="border: 1px solid #000; padding: 8px;">${row}</td></tr>`;
            } else {
              // For medication rows, handle the specific format with fixed column positions
              if (headers[0] === 'Name' && headers.includes('Strength')) {
                // This is a medication table - parse using fixed positions
                const name = row.substring(0, 24).trim();
                const strength = row.substring(25, 36).trim();
                const route = row.substring(37, 46).trim();
                const dosage = row.substring(47, 78).trim();
                const days = row.substring(79).trim();

                tableHTML += '<tr>';
                tableHTML += `<td style="border: 1px solid #000; padding: 8px;">${name || '&nbsp;'}</td>`;
                tableHTML += `<td style="border: 1px solid #000; padding: 8px;">${strength || '&nbsp;'}</td>`;
                tableHTML += `<td style="border: 1px solid #000; padding: 8px;">${route || '&nbsp;'}</td>`;
                tableHTML += `<td style="border: 1px solid #000; padding: 8px;">${dosage || '&nbsp;'}</td>`;
                tableHTML += `<td style="border: 1px solid #000; padding: 8px;">${days || '&nbsp;'}</td>`;
                tableHTML += '</tr>';
              } else {
                // For other tables, try to split the row into columns
                const cells = row.split(/\s{2,}/).filter(cell => cell.trim());
                tableHTML += '<tr>';
                if (cells.length > 0) {
                  cells.forEach(cell => {
                    tableHTML += `<td style="border: 1px solid #000; padding: 8px;">${cell.trim()}</td>`;
                  });
                  // Fill remaining cells if needed
                  for (let i = cells.length; i < headers.length; i++) {
                    tableHTML += '<td style="border: 1px solid #000; padding: 8px;"></td>';
                  }
                } else {
                  // Empty row
                  tableHTML += `<td colspan="${headers.length}" style="border: 1px solid #000; padding: 8px;">${row}</td>`;
                }
                tableHTML += '</tr>';
              }
            }
          });
          tableHTML += '</tbody></table>';

          return tableHTML;
        }

        // Helper function to convert markdown to HTML
        function convertMarkdownToHTML(text) {
          // Convert **bold** to <strong>bold</strong>
          text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
          // Convert *italic* to <em>italic</em> (but not if it's a bullet point)
          text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
          // Remove any remaining stray ** markers
          text = text.replace(/\*\*/g, '');
          return text;
        }

        // Helper function to process normal lines
        function processNormalLine(line, htmlContent, skipRef) {
          // Detect start of duplicate sections to skip (AI-generated patient/surgery info)
          if (line.includes('**Patient') || line.includes('**Surgery Details') ||
              line.includes('**Additional') || line.includes('Information:**') ||
              line.includes('Patient Information') && line.includes('**')) {
            skipRef.skip = true;
            return;
          }

          // Detect end of skip section (next major heading or Description)
          if (skipRef.skip) {
            if (line.startsWith('Description:') || line.match(/^[A-Z][A-Z\s]+:/) && !line.includes('Name:') && !line.includes('Age:') && !line.includes('Gender:')) {
              skipRef.skip = false;
            } else {
              return; // Skip this line
            }
          }

          // Skip duplicate patient info lines (Name, Age, Gender, etc.)
          if (line.includes('• Name:') || line.includes('• Age:') || line.includes('• Gender:') ||
              line.includes('• Surgery Name:') || line.includes('• Surgery Code:') ||
              line.includes('• NABH/NABL Rate:') || line.includes('• Sanction Status:') ||
              line.includes('• Surgeon:') || line.includes('• Anesthetist:')) {
            return;
          }

          if (line.trim() === '') {
            htmlContent.push('<br>');
          } else if (line.startsWith('- ')) {
            // Bullet point with dash
            htmlContent.push(`<li style="margin: 5px 0 5px 20px;">${convertMarkdownToHTML(line.substring(2))}</li>`);
          } else if (line.startsWith('• ') || line.startsWith('* ')) {
            // Bullet point with • or *
            htmlContent.push(`<li style="margin: 5px 0 5px 20px;">${convertMarkdownToHTML(line.substring(2))}</li>`);
          } else if (line.match(/^(PRESENT CONDITION:|INVESTIGATIONS:|MEDICATIONS ON DISCHARGE:|MEDICATIONS PRESCRIBED:|RADIOLOGY INVESTIGATIONS:|LAB INVESTIGATIONS:|Present Condition|Investigations:|Medications on Discharge:|Medications Prescribed:|Case Summary:)/)) {
            // Section headings with or without colons
            htmlContent.push(`<h3 style="font-size: 11pt; font-weight: bold; margin: 15px 0 8px 0;">${convertMarkdownToHTML(line)}</h3>`);
          } else if (line.includes('URGENT CARE') && line.includes('EMERGENCY CARE')) {
            // URGENT CARE text - make it bold with 11pt font
            htmlContent.push(`<p style="font-size: 11pt; font-weight: bold; margin: 8px 0;">${convertMarkdownToHTML(line)}</p>`);
          } else if (line.includes('PLEASE CONTACT:') && (line.includes('7030974619') || line.includes('9373111709'))) {
            // Contact phone numbers - make them bold with 11pt font
            htmlContent.push(`<p style="font-size: 11pt; font-weight: bold; margin: 8px 0;">${convertMarkdownToHTML(line)}</p>`);
          } else if (line.includes(':') && line.indexOf(':') < 30) {
            // Key-value pair
            const colonIndex = line.indexOf(':');
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();

            if (key && value) {
              htmlContent.push(`<div style="margin: 8px 0;"><strong>${convertMarkdownToHTML(key)}:</strong> ${convertMarkdownToHTML(value)}</div>`);
            } else {
              htmlContent.push(`<p style="margin: 8px 0;">${convertMarkdownToHTML(line)}</p>`);
            }
          } else {
            // Regular paragraph
            htmlContent.push(`<p style="margin: 8px 0;">${convertMarkdownToHTML(line)}</p>`);
          }
        }

        // Helper function to format patient details in a two-column layout
        function formatPatientDetailsTable(detailsData) {
          // Parse the patient details data
          const details = {};

          // Debug logging

          detailsData.forEach(line => {
            // Use regex to find all key-value pairs in the line
            // Pattern matches: "Key : Value" where key can have spaces/slashes
            const regex = /([A-Za-z\s\/]+?):\s*([^:]*?)(?=\s{2,}[A-Za-z]|$)/g;
            let match;

            while ((match = regex.exec(line)) !== null) {
              const key = match[1].trim();
              const value = match[2].trim();

              // Store the key-value pair
              if (key) {
                details[key] = value || 'N/A';
              }
            }

            // Fallback: If no matches found with regex, try simple split
            if (Object.keys(details).length === 0 && line.includes(':')) {
              const colonIndex = line.indexOf(':');
              const key = line.substring(0, colonIndex).trim();
              const remainingText = line.substring(colonIndex + 1);

              // Check if there's another key-value pair in the same line
              const nextKeyMatch = remainingText.match(/\s{2,}([A-Za-z\s\/]+?):/);
              if (nextKeyMatch) {
                const value = remainingText.substring(0, nextKeyMatch.index).trim();
                details[key] = value || 'N/A';

                // Parse the second key-value pair
                const secondPart = remainingText.substring(nextKeyMatch.index);
                const secondColonIndex = secondPart.indexOf(':');
                if (secondColonIndex > -1) {
                  const secondKey = secondPart.substring(0, secondColonIndex).trim();
                  const secondValue = secondPart.substring(secondColonIndex + 1).trim();
                  details[secondKey] = secondValue || 'N/A';
                }
              } else {
                // Single key-value pair in the line
                details[key] = remainingText.trim() || 'N/A';
              }
            }
          });


          // Create a two-column table layout for patient details
          let html = '<table style="width: 100%; margin: 20px 0; border-collapse: collapse;">';
          html += '<tr>';
          html += '<td style="width: 50%; vertical-align: top; padding-right: 20px;">';

          // Left column items
          const leftColumnKeys = ['Name', 'Primary Care Provider', 'Sex / Age', 'Tariff', 'Admission Date'];
          leftColumnKeys.forEach(key => {
            const value = details[key] || 'N/A';
            html += `<div style="margin: 8px 0;"><strong>${key}:</strong> ${value}</div>`;
          });

          html += '</td>';
          html += '<td style="width: 50%; vertical-align: top;">';

          // Right column items
          const rightColumnKeys = ['Patient ID', 'Registration ID', 'Mobile No', 'Address', 'Visit Date', 'Discharge Date'];
          rightColumnKeys.forEach(key => {
            const value = details[key] || 'N/A';
            html += `<div style="margin: 8px 0;"><strong>${key}:</strong> ${value}</div>`;
          });

          html += '</td>';
          html += '</tr>';
          html += '</table>';

          return html;
        }

        // Helper function to format discharge medications in a table
        function formatMedicationsTable(medicationsData) {
          // Create a table for medications
          let html = '<table style="width: 100%; border-collapse: collapse; margin: 15px 0;">';

          // Add table headers
          html += '<thead><tr>';
          html += '<th style="border: 1px solid #000; padding: 8px; background-color: #f0f0f0; font-weight: bold; text-align: left;">Medicine Name</th>';
          html += '<th style="border: 1px solid #000; padding: 8px; background-color: #f0f0f0; font-weight: bold; text-align: left;">Dosage/Instructions</th>';
          html += '</tr></thead>';

          // Add table body
          html += '<tbody>';
          medicationsData.forEach(medLine => {
            // Parse medication line (format: "MedicationName: Dosage/Instructions")
            const colonIndex = medLine.indexOf(':');
            let medicationName = '';
            let dosageInstructions = '';

            if (colonIndex > -1) {
              medicationName = medLine.substring(0, colonIndex).trim();
              dosageInstructions = medLine.substring(colonIndex + 1).trim();
            } else {
              // If no colon, treat the whole line as medication name
              medicationName = medLine;
              dosageInstructions = 'As directed';
            }

            html += '<tr>';
            html += `<td style="border: 1px solid #000; padding: 8px;">${medicationName}</td>`;
            html += `<td style="border: 1px solid #000; padding: 8px;">${dosageInstructions}</td>`;
            html += '</tr>';
          });

          html += '</tbody></table>';

          return html;
        }

        // Join all HTML content
        formattedContent = htmlContent.join('');
      } else {
        // Already HTML format
        formattedContent = dischargeSummaryText;
      }

      // Create complete HTML document for printing
      const printHTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>OPD Summary - ${patient?.patients?.name || 'Patient'}</title>
    <style>
        @page {
            size: A4;
            margin: 20mm;
        }

        body {
            font-family: Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.4;
            color: black;
            margin: 0;
            padding: 0;
        }

        .header {
            text-align: center;
            margin-bottom: 15px;
        }

        .header h1 {
            font-size: 16pt;
            font-weight: bold;
            margin: 0;
            padding-bottom: 10px;
            border-bottom: 3px solid black;
        }

        .patient-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20pt;
            margin-bottom: 20pt;
            font-size: 11pt;
        }

        .patient-info p {
            margin: 4pt 0;
        }

        .content {
            font-size: 11pt;
            line-height: 1.4;
        }

        .content p {
            margin-bottom: 8pt;
        }

        .content h2, .content h3 {
            font-size: 13pt;
            font-weight: bold;
            margin-top: 15pt;
            margin-bottom: 8pt;
            page-break-after: avoid;
        }

        .content table {
            page-break-inside: avoid;
        }

        .content strong {
            font-weight: bold;
        }

        /* Lab Results Specific Styling */
        .lab-results {
            margin: 12pt 0;
        }

        .lab-group {
            margin-bottom: 8pt;
        }

        .lab-group-title {
            font-weight: bold;
            font-size: 12pt;
            margin-bottom: 4pt;
            color: #2c3e50;
        }

        .lab-result {
            margin-left: 16pt;
            margin-bottom: 2pt;
            font-size: 10pt;
        }

        .abnormal-result {
            color: #e74c3c;
            font-weight: bold;
        }

        .critical-values {
            background-color: #fdf2f2;
            border-left: 4pt solid #e74c3c;
            padding: 8pt;
            margin: 12pt 0;
        }

        .critical-values h4 {
            margin: 0 0 8pt 0;
            color: #e74c3c;
            font-size: 11pt;
        }

        table {
            border-collapse: collapse;
            width: 100%;
            margin: 15px 0;
        }

        th, td {
            border: 1px solid black;
            padding: 8px;
            text-align: left;
            font-size: 10pt;
        }

        th {
            background-color: #f0f0f0;
            font-weight: bold;
        }

        .patient-info-table {
            border: none;
            margin: 20px 0;
            width: 100%;
        }

        .patient-info-table td {
            border: none;
            padding: 4px 10px;
            font-size: 11pt;
        }

        h3 {
            font-size: 11pt;
            font-weight: bold;
            margin: 25px 0 10px 0;
            border-bottom: 2px solid black;
            padding-bottom: 5px;
        }

        .content {
            margin-top: 20px;
        }

        .content p {
            margin: 10px 0;
        }

        ul {
            margin: 10px 0 10px 20px;
        }

        li {
            margin: 5px 0;
        }

        .advice-section {
            margin-top: 30px;
            padding-top: 20px;
        }

        .advice-table {
            margin-top: 20px;
            width: 100%;
        }

        .emergency-note {
            margin-top: 30px;
            padding: 15px;
            background-color: #f9f9f9;
            border: 1px solid #ccc;
            text-align: center;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="content">
        ${formattedContent}
    </div>
</body>
</html>`;

      // Open new window and print
      const printWindow = window.open('', '_blank', 'width=800,height=600');
      if (!printWindow) {
        alert('Print window blocked. Please allow pop-ups and try again.');
        return;
      }

      printWindow.document.write(printHTML);
      printWindow.document.close();

      // Wait for content to load then print
      printWindow.onload = () => {
        printWindow.print();
        // Close window after printing
        printWindow.onafterprint = () => {
          printWindow.close();
        };
      };

    } catch (error) {
      console.error('Print error:', error);
      alert('Failed to print. Please try again or check your browser settings.');
    }
  };

  // Check if this is an OPD/outpatient visit (no payment gate needed)
  const isOpdVisit = (() => {
    const vt = (patient?.visit_type || '').toLowerCase();
    return vt === 'consultation' || vt === 'follow-up' || vt === 'follow up' || vt === 'opd' || vt === 'new' || vt === 'review';
  })();

  // OPD visits can always print/preview; IPD visits require bill_paid
  const canPrintAndPreview = isOpdVisit || !!patient?.bill_paid;

  // Handle preview toggle with payment check
  const togglePreview = () => {
    if (!canPrintAndPreview) {
      alert('⚠️ Final Payment Required\n\nPlease complete the final payment before previewing the OPD summary.');
      return;
    }
    setShowPreview(!showPreview);
  };

  // Handle print with payment check
  const handlePrintWithCheck = () => {
    if (!canPrintAndPreview) {
      alert('⚠️ Final Payment Required\n\nPlease complete the final payment before printing the OPD summary.');
      return;
    }
    handlePrint();
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading patient data...</div>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Patient Not Found</h1>
          <p className="text-gray-600 mb-4">Could not find patient data for visit ID: {visitId}</p>
          <Button onClick={() => navigate('/opd-summary')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to OPD Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => navigate('/opd-summary')}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to OPD
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                OPD Summary
              </h1>
              <p className="text-gray-600">
                Patient: {patient.patients?.name} | Visit ID: {patient.visit_id}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSaving && (
              <Badge variant="outline" className="text-blue-600 border-blue-200">
                Saving...
              </Badge>
            )}
            {isSaved && !isSaving && (
              <Badge variant="outline" className="text-green-600 border-green-200">
                ✓ Saved
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Patient Search Bar */}
      <div className="mb-4 relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search patient by name, ID, or visit ID..."
              value={patientSearchQuery}
              onChange={(e) => handlePatientSearch(e.target.value)}
              onFocus={() => patientSearchQuery.length >= 2 && setShowSearchResults(true)}
              onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
            )}
          </div>
        </div>
        {showSearchResults && patientSearchResults.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {patientSearchResults.map((result) => (
              <button
                key={result.visit_id}
                onClick={() => {
                  navigate(`/discharge-summary-edit/${result.visit_id}`);
                  setShowSearchResults(false);
                  setPatientSearchQuery('');
                }}
                className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b border-gray-100 last:border-b-0 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium text-sm text-gray-900">{result.name}</div>
                  <div className="text-xs text-gray-500">
                    {result.patients_id} | {result.visit_id} | {result.visit_type}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Dr. {result.appointment_with}</div>
                  <div className="text-xs text-gray-400">{result.visit_date}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        {showSearchResults && patientSearchQuery.length >= 2 && patientSearchResults.length === 0 && !isSearching && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-sm text-gray-500">
            No patients found matching "{patientSearchQuery}"
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patient Information Sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Patient Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-600">Name</label>
                <div className="font-medium">{patient.patients?.name || 'Unknown'}</div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Patient ID</label>
                <div className="font-mono text-sm">{patient.patients?.patients_id || 'N/A'}</div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Gender/Age</label>
                <div>{patient.patients?.gender || 'Unknown'}/{patient.patients?.age || 'N/A'} Years</div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Visit Type</label>
                <Badge variant="outline">{patient.visit_type || 'General'}</Badge>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Doctor</label>
                <div>{patient.appointment_with || 'Not Assigned'}</div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Diagnosis</label>
                <div>
                  {visitDiagnosis?.primaryDiagnosis || patient.diagnosis || 'No diagnosis recorded'}
                  {visitDiagnosis?.secondaryDiagnoses && visitDiagnosis.secondaryDiagnoses.length > 0 && (
                    <div className="text-sm text-gray-500 mt-1">
                      Secondary: {visitDiagnosis.secondaryDiagnoses.join(', ')}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Corporate</label>
                <div>{patient.patients?.corporate || 'Private'}</div>
              </div>
            </CardContent>
          </Card>

          {/* OT Notes / Operative Details Section */}
          {editablePatientData?.otData && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg text-green-700">Operative Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Surgery Name */}
                {editablePatientData.otData.surgeryName && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Surgery</label>
                    <div className="font-medium">{editablePatientData.otData.surgeryName}</div>
                  </div>
                )}

                {/* Multiple Surgeons */}
                {editablePatientData.otData.surgeon && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Surgeon(s)</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {editablePatientData.otData.surgeon.split(',').map((s: string, i: number) => (
                        <span key={i} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                          {s.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anaesthetist */}
                {editablePatientData.otData.anaesthetist && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Anaesthetist</label>
                    <div>{editablePatientData.otData.anaesthetist}</div>
                  </div>
                )}

                {/* Anaesthesia Type */}
                {editablePatientData.otData.anaesthesia && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Anaesthesia</label>
                    <div>{editablePatientData.otData.anaesthesia}</div>
                  </div>
                )}

                {/* Implant */}
                {editablePatientData.otData.implant && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Implant</label>
                    <div>{editablePatientData.otData.implant}</div>
                  </div>
                )}

                {/* Procedure Performed */}
                {editablePatientData.otData.procedurePerformed && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Procedure</label>
                    <div className="text-sm">{editablePatientData.otData.procedurePerformed}</div>
                  </div>
                )}

                {/* Description */}
                {editablePatientData.otData.description && (
                  <div>
                    <label className="text-sm font-medium text-gray-600">Operative Notes</label>
                    <div className="text-sm bg-gray-50 p-2 rounded mt-1 whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {editablePatientData.otData.description}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Hidden file input for upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileUpload}
        />

        {/* Buttons above Panel 1: Scan OPD + Upload OPD */}
        <div className="lg:col-span-2 flex items-center gap-2 mb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={startCamera}
            className="flex items-center gap-2 bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-700"
            title="Take photo of handwritten OPD summary"
          >
            <Camera className="h-4 w-4" />
            Scan OPD
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700"
            title="Upload photo of handwritten OPD summary"
          >
            <Upload className="h-4 w-4" />
            Upload OPD
          </Button>
        </div>

        {/* Panel 1: Extracted Handwritten Notes - ALWAYS VISIBLE */}
        <div className="lg:col-span-2">
          <Card className="border-purple-200 bg-purple-50/30 mb-4">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2 text-purple-700">
                  <Edit3 className="h-4 w-4" />
                  Panel 1: Extracted Handwritten Notes
                </CardTitle>
                {extractedNotes && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExtractedNotes('')}
                    className="text-gray-400 hover:text-red-500 h-7 w-7 p-0"
                    title="Clear extracted notes"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <textarea
                className="w-full bg-white border border-purple-100 rounded-lg p-4 min-h-[80px] max-h-60 overflow-y-auto text-sm text-gray-800 font-sans leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder='Type handwritten notes here, or use "Scan OPD" / "Upload OPD" to extract via OCR...'
                value={extractedNotes}
                onChange={(e) => setExtractedNotes(e.target.value)}
              />
              <p className="text-xs text-purple-500 mt-2">
                Type notes directly or extract from a handwritten document via OCR. This text will be included when generating the AI summary.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Button above Panel 2: Fetch Data */}
        <div className="lg:col-span-2 flex items-center gap-2 mb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleFetchData}
            disabled={isFetchingData}
            className="flex items-center gap-2 bg-green-50 hover:bg-green-100 border-green-200 text-green-700 disabled:opacity-60"
          >
            {isFetchingData ? (
              <>
                <span className="h-4 w-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                Fetching...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Fetch Data
              </>
            )}
          </Button>
          {isFetchingData && fetchProgress && (
            <span className="text-xs text-green-600 animate-pulse">{fetchProgress}</span>
          )}
        </div>

        {/* Panel 2: Fetched Database Data - ALWAYS VISIBLE */}
        <div className="lg:col-span-2">
          <Card className="border-green-200 bg-green-50/30 mb-4">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2 text-green-700">
                  <Download className="h-4 w-4" />
                  Panel 2: Fetched Data (Extracted Notes + Lab/Radiology + Demographics)
                </CardTitle>
                {fetchedDataText && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setFetchedDataText(''); setDataFetched(false); }}
                    className="text-gray-400 hover:text-red-500 h-7 w-7 p-0"
                    title="Clear fetched data"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="bg-white border border-green-100 rounded-lg p-4 min-h-[80px] max-h-72 overflow-y-auto">
                {fetchedDataText ? (
                  <pre className="whitespace-pre-wrap text-xs text-gray-800 font-mono leading-relaxed">{fetchedDataText}</pre>
                ) : (
                  <p className="text-sm text-gray-400 italic">No data fetched yet. Click "Fetch Data" to load patient demographics, lab results, radiology reports, and extracted notes.</p>
                )}
              </div>
              <p className="text-xs text-green-600 mt-2">
                Combined data: patient demographics, lab results, radiology, medications, and diagnosis. Click "Generate by AI" after fetching.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Buttons above Panel 3: Generate by AI, Preview, Print, Clear, Save */}
        <div className="lg:col-span-2 flex items-center gap-2 flex-wrap mb-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAIGenerate}
                    disabled={isGenerating || !patient || !dataFetched}
                    className="flex items-center gap-2"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {isGenerating ? 'Generating...' : 'Generate by AI'}
                  </Button>
                </span>
              </TooltipTrigger>
              {!dataFetched && (
                <TooltipContent className="bg-orange-600 text-white border-orange-700 font-semibold">
                  <p>Click "Fetch Data" first</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={togglePreview}
                    className="flex items-center gap-2"
                    disabled={!canPrintAndPreview}
                  >
                    <Eye className="h-4 w-4" />
                    {showPreview ? 'Edit' : 'Preview'}
                  </Button>
                </span>
              </TooltipTrigger>
              {!canPrintAndPreview && (
                <TooltipContent className="bg-red-600 text-white border-red-700 font-semibold">
                  <p className="flex items-center gap-2">
                    <span className="text-lg">⚠️</span>
                    Please complete final payment
                  </p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrintWithCheck}
                    className="flex items-center gap-2"
                    disabled={!canPrintAndPreview}
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                </span>
              </TooltipTrigger>
              {!canPrintAndPreview && (
                <TooltipContent className="bg-red-600 text-white border-red-700 font-semibold">
                  <p className="flex items-center gap-2">
                    <span className="text-lg">⚠️</span>
                    Please complete final payment
                  </p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (window.confirm('Clear all content? This cannot be undone.')) {
                setDischargeSummaryText('');
                setExtractedNotes('');
                setFetchedDataText('');
                setDataFetched(false);
                setShowPreview(false);
              }
            }}
            className="flex items-center gap-2 text-red-600 hover:bg-red-50 border-red-200"
            title="Clear all content to start fresh"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>

        {/* Panel 3: AI Generated OPD Summary - ALWAYS VISIBLE */}
        <div className="lg:col-span-2">
          <Card className="border-blue-200 bg-blue-50/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-blue-700">
                  <Sparkles className="h-5 w-5" />
                  Panel 3: OPD Summary (AI Generated)
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {showPreview ? (
                <div className="border rounded-lg p-8 bg-white min-h-[500px] max-w-4xl mx-auto print:p-4 print:shadow-none">
                  {/* Hospital Header */}
                  <div className="text-center border-b-2 border-gray-800 pb-4 mb-6">
                    <h1 className="text-2xl font-bold text-gray-800 mb-2">OPD SUMMARY</h1>
                    <div className="text-sm text-gray-600">
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="text-left">
                          <p><strong>Name:</strong> {patient?.patients?.name || 'Patient Name'}</p>
                          <p><strong>Primary Care Provider:</strong> Dr. {patient?.appointment_with || 'Attending Physician'}</p>
                          <p><strong>Sex / Age:</strong> {patient?.patients?.gender || 'N/A'} / {patient?.patients?.age || 'N/A'} Year</p>
                          <p><strong>Tariff:</strong> {patient?.patients?.corporate || 'Private'}</p>
                          <p><strong>Admission Date:</strong> {patient?.admission_date || patient?.visit_date || new Date().toLocaleDateString()}</p>
                        </div>
                        <div className="text-left">
                          <p><strong>Patient ID:</strong> {patient?.visit_id || 'N/A'}</p>
                          <p><strong>Registration ID:</strong> {patient?.patients?.patients_id || 'N/A'}</p>
                          <p><strong>Mobile No:</strong> {patient?.patients?.phone || 'N/A'}</p>
                          <p><strong>Address:</strong> {patient?.patients?.address || 'N/A'}</p>
                          <p><strong>Visit Date:</strong> {patient?.discharge_date || new Date().toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AI Generated Content */}
                  <div
                    className="prose prose-sm max-w-none leading-relaxed"
                    style={{
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      fontSize: '14px',
                      lineHeight: '1.6'
                    }}
                    dangerouslySetInnerHTML={{
                      __html: (() => {
                        let text = dischargeSummaryText;
                        // Convert markdown tables to HTML BEFORE line break replacements
                        text = text.replace(/((?:\|[^\n]+\|\n?)+)/g, (tableBlock) => {
                          const rows = tableBlock.trim().split('\n').filter(r => r.trim());
                          if (rows.length < 2) return tableBlock;
                          // Filter out separator rows (|---|---|)
                          const dataRows = rows.filter(r => r.replace(/[\s|:\-]/g, '').length > 0);
                          if (dataRows.length < 1) return tableBlock;
                          let html = '<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;"><tbody>';
                          dataRows.forEach((row, idx) => {
                            const cells = row.split('|').filter(c => c.trim()).map(c => c.trim());
                            if (idx === 0) {
                              html += '<tr>' + cells.map(c => `<th style="border:1px solid #999;padding:6px 8px;background:#f0f0f0;font-weight:bold;text-align:left;font-size:12px;">${c}</th>`).join('') + '</tr>';
                            } else {
                              html += '<tr>' + cells.map(c => `<td style="border:1px solid #ccc;padding:5px 8px;font-size:12px;">${c}</td>`).join('') + '</tr>';
                            }
                          });
                          html += '</tbody></table>';
                          return html;
                        });
                        // Then do standard markdown conversions
                        text = text
                          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                          .replace(/\*(.*?)\*/g, '<em>$1</em>')
                          .replace(/\n\n/g, '</p><p class="mb-4">')
                          .replace(/\n/g, '<br>')
                          .replace(/^\s*/, '<p class="mb-4">')
                          .replace(/\s*$/, '</p>');
                        return text;
                      })()
                    }}
                  />
                </div>
              ) : (
                <div className="relative">
                  <textarea
                    className="w-full min-h-[500px] p-4 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical font-mono text-sm leading-relaxed"
                    placeholder="Enter OPD summary details here...

• Chief Complaints
• Diagnosis
• Treatment Given
• Condition at Visit
• Follow-up Instructions
• Medications Prescribed"
                    value={dischargeSummaryText}
                    onChange={(e) => setDischargeSummaryText(e.target.value)}
                  />

                  {/* Save indicators */}
                  {isSaving && (
                    <div className="absolute bottom-4 right-4 text-sm text-blue-600 bg-blue-50 px-3 py-1 rounded border border-blue-200">
                      Saving...
                    </div>
                  )}
                  {isSaved && !isSaving && (
                    <div className="absolute bottom-4 right-4 text-sm text-green-600 bg-green-50 px-3 py-1 rounded border border-green-200">
                      ✓ Saved
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 text-xs text-gray-500">
                Auto-saves as you type. Character count: {dischargeSummaryText.length}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>


      {/* Camera/Upload OCR Dialog */}
      <Dialog open={showCameraDialog} onOpenChange={(open) => {
        if (!open) closeCameraDialog();
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              {capturedImage ? 'Review Captured Image' : 'Capture Handwritten OPD Summary'}
            </DialogTitle>
            <DialogDescription>
              {capturedImage
                ? 'Review the image and click "Extract Text" to process the handwritten content.'
                : 'Position the handwritten OPD summary in front of the camera and capture it.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Camera View */}
            {isCapturing && !capturedImage && (
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full rounded-lg bg-black"
                  style={{ maxHeight: '400px', objectFit: 'contain' }}
                />
                <canvas ref={canvasRef} className="hidden" />
                <div className="flex justify-center gap-3 mt-4">
                  <Button
                    onClick={() => void capturePhoto()}
                    className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white rounded-full px-6"
                  >
                    <Camera className="h-5 w-5" />
                    Capture
                  </Button>
                  <Button
                    variant="outline"
                    onClick={closeCameraDialog}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Captured/Uploaded Image Preview */}
            {capturedImage && (
              <div className="space-y-4">
                <div className="border rounded-lg overflow-hidden">
                  <img
                    src={capturedImage}
                    alt="Captured OPD Summary"
                    className="w-full object-contain"
                    style={{ maxHeight: '400px' }}
                  />
                </div>
                <GeotagStatus
                  geo={capturedGeo}
                  loading={gpsRetryLoading}
                  onRetry={() => void retryCapturedGps()}
                />
                <div className="flex justify-center gap-3">
                  <Button
                    onClick={() => processImageWithOCR(capturedImage)}
                    disabled={isProcessingOCR}
                    className="flex items-center gap-2"
                  >
                    {isProcessingOCR ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {isProcessingOCR ? 'Extracting Text...' : 'Extract Text'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCapturedImage(null);
                      setCapturedGeo(null);
                      capturedBlobRef.current = null;
                      startCamera();
                    }}
                    disabled={isProcessingOCR}
                  >
                    Retake
                  </Button>
                  <Button
                    variant="outline"
                    onClick={closeCameraDialog}
                    disabled={isProcessingOCR}
                  >
                    Cancel
                  </Button>
                </div>
                {isProcessingOCR && (
                  <div className="text-center text-sm text-blue-600 bg-blue-50 p-3 rounded-lg">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    Processing handwritten text with AI... This may take a few seconds.
                  </div>
                )}
              </div>
            )}

            {/* Initial state - no camera yet */}
            {!isCapturing && !capturedImage && (
              <div className="text-center py-8 text-gray-500">
                <Camera className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p>Starting camera...</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Generation Modal */}
      <Dialog open={showGenerationModal} onOpenChange={setShowGenerationModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              AI OPD Summary Generation
            </DialogTitle>
            <DialogDescription>
              Review and edit the patient data and prompt before generating the AI OPD summary.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Editable Patient Data Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Edit3 className="h-4 w-4" />
                Patient Data (Editable)
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="primaryDiagnosis">Primary Diagnosis</Label>
                  <Input
                    id="primaryDiagnosis"
                    value={editablePatientData.primaryDiagnosis || ''}
                    onChange={(e) => setEditablePatientData({...editablePatientData, primaryDiagnosis: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admissionDate">Admission Date</Label>
                  <Input
                    id="admissionDate"
                    value={editablePatientData.admissionDate || ''}
                    readOnly
                    disabled
                    className="bg-gray-100 cursor-not-allowed"
                    title="Date of admission cannot be changed"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="complaints">Chief Complaints (comma-separated)</Label>
                <Input
                  id="complaints"
                  value={editablePatientData.complaints?.join(', ') || ''}
                  onChange={(e) => setEditablePatientData({
                    ...editablePatientData,
                    complaints: e.target.value.split(',').map(c => c.trim()).filter(Boolean)
                  })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="complications">Complications (comma-separated)</Label>
                <Input
                  id="complications"
                  value={editablePatientData.complications?.join(', ') || ''}
                  onChange={(e) => setEditablePatientData({
                    ...editablePatientData,
                    complications: e.target.value.split(',').map(c => c.trim()).filter(Boolean)
                  })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="medications">Current Medications (comma-separated)</Label>
                <Input
                  id="medications"
                  value={editablePatientData.medications?.join(', ') || ''}
                  onChange={(e) => setEditablePatientData({
                    ...editablePatientData,
                    medications: e.target.value.split(',').map(m => m.trim()).filter(Boolean)
                  })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="labResults">Lab Results</Label>
                <textarea
                  id="labResults"
                  className="w-full h-32 p-2 border rounded-md text-sm font-mono"
                  value={editablePatientData.labResults?.join('\n') || ''}
                  onChange={(e) => setEditablePatientData({
                    ...editablePatientData,
                    labResults: e.target.value.split('\n').filter(Boolean)
                  })}
                  placeholder="Lab results will appear here..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="abnormalLabResults">Critical/Abnormal Lab Values (comma-separated)</Label>
                <Input
                  id="abnormalLabResults"
                  value={editablePatientData.abnormalLabResults?.join(', ') || ''}
                  onChange={(e) => setEditablePatientData({
                    ...editablePatientData,
                    abnormalLabResults: e.target.value.split(',').map(r => r.trim()).filter(Boolean)
                  })}
                  placeholder="Abnormal lab values..."
                />
              </div>
            </div>

            {/* Editable Prompt Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Gemini Prompt (Editable)
              </h3>
              <div className="space-y-2">
                <Label htmlFor="prompt">AI Generation Prompt</Label>
                <Textarea
                  id="prompt"
                  value={editablePrompt}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.includes(':summary:')) {
                      const summaryPrompt = `Act like a medical specialist. Make a professionally written OPD summary. Make up facts. Add findings which are not provided to you. Come up with creative complaints, events during visit to hospital and relevant examination findings. Add medications to be taken at home in Indian BRANDS. The entire summary should be a minimum of 800 words. Do not mention the name, sex or age of the patient. The person who is going to read what you share will be a doctor. Start the summary with the Diagnosis, followed by medication. Medications MUST be in a markdown table like this:

| Medication Name | Strength | Route | Dosage | Duration |
|-----------------|----------|-------|--------|----------|
| Tab Pan | 40 mg | PO | BD | 15 days |

Another line in Hindi should be added in the column of dosage in addition to English (e.g. "BD (दिन में दो बार)"). This patient does not have comorbidities other than what is mentioned.`;
                      setEditablePrompt(val.replace(':summary:', '\n\n' + summaryPrompt + '\n\n'));
                    } else {
                      setEditablePrompt(val);
                    }
                  }}
                  rows={12}
                  className="text-sm"
                  placeholder="Edit the Gemini prompt for OPD summary generation... (Type :summary: to insert the specialist prompt)"
                />
              </div>
              <p className="text-xs text-gray-500">
                Prompt length: {editablePrompt.length} characters
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setShowGenerationModal(false)}
                disabled={isGenerating}
              >
                Cancel
              </Button>
              <Button
                onClick={generateAISummary}
                disabled={isGenerating}
                className="flex items-center gap-2"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isGenerating ? 'Generating...' : 'Generate Summary'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
