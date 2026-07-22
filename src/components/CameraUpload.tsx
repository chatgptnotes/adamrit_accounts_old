import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Camera,
  Upload,
  X,
  Image,
  FileText,
  Search,
  SwitchCamera,
  StopCircle,
  Sparkles,
  Mic,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/activity-logger';
import { useAuth } from '@/contexts/AuthContext';
import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import { downscaleImageForVision } from '@/lib/downscaleImage';
import { captureInAppPhoto, reapplyGeotagToBlob } from '@/lib/captureInAppPhoto';
import { captureGeolocation, geoToDbFields, googleMapsUrl, type GeoCapture } from '@/lib/geotag';
import { stampGeotagOnImage } from '@/lib/geotagImage';
import { GeotagStatus } from '@/components/GeotagStatus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CameraUploadProps {
  isDialog?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface PatientResult {
  id: string;
  name: string;
  patients_id?: string;
  latest_visit_id?: string;
}

interface FileUploadRecord {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  category: string;
  patient_name: string | null;
  notes: string | null;
  created_at: string;
  latitude?: number | null;
  longitude?: number | null;
}

type BillDocumentCategory =
  | 'treatment_sheet'
  | 'monitor_chart'
  | 'dialysis'
  | 'lab_investigation'
  | 'radiology_investigation'
  | 'ot_notes'
  | 'ot_photos'
  | 'implant_invoice'
  | 'implant_sticker'
  | 'discharge_summary';

type ClinicalUploadCategory =
  | 'prescription'
  | 'opd_summary'
  | 'report'
  | 'xray'
  | 'mri_report'
  | 'ct_scan_report'
  | 'document'
  | 'photo'
  | 'id_proof';

type UploadCategory = BillDocumentCategory | ClinicalUploadCategory;

interface OpdExtractedData {
  patientName: string;
  age: string;
  gender: string;
  phone: string;
  chiefComplaint: string;
  diagnosis: string;
  doctorName: string;
  vitals: {
    bp: string;
    pulse: string;
    temperature: string;
    weight: string;
    spo2: string;
  };
  medicines: string[];
  advice: string;
  followUp: string;
}

type AiUploadStep = 'idle' | 'ai_input' | 'ai_loading' | 'ai_confirm' | 'manual';

interface AiParseResult {
  patientName: string | null;
  patientId: string | null;
  category: UploadCategory | null;
  notes: string | null;
}

const BILL_DOCUMENT_OPTIONS: { value: BillDocumentCategory; label: string }[] = [
  { value: 'treatment_sheet', label: 'Treatment Sheet' },
  { value: 'monitor_chart', label: 'Monitor Chart' },
  { value: 'dialysis', label: 'Dialysis' },
  { value: 'lab_investigation', label: 'Lab Investigation' },
  { value: 'radiology_investigation', label: 'Radiology Investigation' },
  { value: 'ot_notes', label: 'OT Notes' },
  { value: 'ot_photos', label: 'OT Photos' },
  { value: 'implant_invoice', label: 'Implant Invoice' },
  { value: 'implant_sticker', label: 'Implant Sticker' },
  { value: 'discharge_summary', label: 'Discharge Summary' },
];

const CLINICAL_UPLOAD_OPTIONS: { value: ClinicalUploadCategory; label: string }[] = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'opd_summary', label: 'OPD Summary' },
  { value: 'report', label: 'Report' },
  { value: 'xray', label: 'X-Ray' },
  { value: 'mri_report', label: 'MRI Report' },
  { value: 'ct_scan_report', label: 'CT Scan Report' },
  { value: 'document', label: 'Document' },
  { value: 'photo', label: 'Photo' },
  { value: 'id_proof', label: 'ID Proof' },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];

// ---------------------------------------------------------------------------
// Helper: human-readable time-ago
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Helper: format file size
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const CameraUpload: React.FC<CameraUploadProps> = ({
  isDialog = false,
  open = false,
  onOpenChange,
}) => {
  const { toast } = useToast();
  const { hospitalConfig } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const streamRef = useRef<MediaStream | null>(null);

  // File / capture state
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedGeo, setCapturedGeo] = useState<GeoCapture | null>(null);
  const [gpsRetryLoading, setGpsRetryLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Metadata form state
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [category, setCategory] = useState<UploadCategory>('treatment_sheet');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);

  // AI Smart Upload state
  const [aiStep, setAiStep] = useState<AiUploadStep>('idle');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiParsed, setAiParsed] = useState<AiParseResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Prescription transcription state
  const [prescriptionResult, setPrescriptionResult] = useState<string | null>(null);
  const [showPrescriptionModal, setShowPrescriptionModal] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [savingPrescription, setSavingPrescription] = useState(false);
  const [reviewMedicines, setReviewMedicines] = useState<{name: string; generic_name: string; brand_name: string; strength: string; route: string; frequency: string; duration: string; instructions: string; qty: number; checked: boolean}[]>([]);
  const [prescriptionDoctor, setPrescriptionDoctor] = useState('');
  const [prescriptionStep, setPrescriptionStep] = useState<'review' | 'saved' | 'done'>('review');
  const [savedPrintHtml, setSavedPrintHtml] = useState<string>('');
  const [savedPrescriptionNumber, setSavedPrescriptionNumber] = useState<string>('');
  // Persist patient info for prescription modal (survives clearCapture)
  const [prescriptionPatient, setPrescriptionPatient] = useState<PatientResult | null>(null);
  // Source image of the uploaded prescription — linked to the prescription row
  const [prescriptionImageUrl, setPrescriptionImageUrl] = useState<string | null>(null);
  const [prescriptionImageType, setPrescriptionImageType] = useState<string | null>(null);

  // OPD Summary extraction state
  const [opdExtracted, setOpdExtracted] = useState<OpdExtractedData | null>(null);
  const [showOpdModal, setShowOpdModal] = useState(false);
  const [savingOpd, setSavingOpd] = useState(false);

  // Recent uploads state
  const [recentUploads, setRecentUploads] = useState<FileUploadRecord[]>([]);
  const [showAllUploads, setShowAllUploads] = useState(false);

  // -------------------------------------------------------------------------
  // Fetch recent uploads
  // -------------------------------------------------------------------------

  const fetchRecentUploads = useCallback(async () => {
    try {
      const raw = localStorage.getItem('hmis_user');
      const user = raw ? JSON.parse(raw) : null;
      const userId = user?.id || user?.email || null;

      let query = (supabase as any)
        .from('file_uploads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (userId) {
        query = query.eq('uploaded_by', userId);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error fetching recent uploads:', error);
        return;
      }
      setRecentUploads((data as FileUploadRecord[]) || []);
    } catch (e) {
      console.error('Error fetching recent uploads:', e);
    }
  }, []);

  useEffect(() => {
    fetchRecentUploads();
  }, [fetchRecentUploads]);

  // -------------------------------------------------------------------------
  // Camera handling
  // -------------------------------------------------------------------------

  const startCamera = useCallback(async () => {
    try {
      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait for video to be ready before marking camera active
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => {});
          setCameraActive(true);
        };
        // Fallback: mark active after short delay if metadata event doesn't fire
        setTimeout(() => setCameraActive(true), 500);
      }
    } catch (err) {
      console.error('Camera access error:', err);
      toast({
        title: 'Camera Error',
        description: 'Unable to access camera. Please check permissions.',
        variant: 'destructive',
      });
    }
  }, [facingMode, toast]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const switchCamera = useCallback(() => {
    // Stop stream but don't reset cameraActive — we want to restart with new facing mode
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  }, []);

  // Restart camera when facingMode changes while camera was active
  useEffect(() => {
    if (cameraActive) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  // Cleanup camera on unmount or dialog close
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) {
      toast({ title: 'Camera not ready', description: 'Please wait for the camera to initialize.', variant: 'destructive' });
      return;
    }

    const result = await captureInAppPhoto(videoRef.current, canvasRef.current, 0.9, {
      placeLabel: `${hospitalConfig.fullName}, ${hospitalConfig.contactInfo.address}, India`,
    });
    if (result) {
      setCapturedBlob(result.blob);
      setCapturedGeo(result.geo);
      setSelectedFile(null);
      const url = URL.createObjectURL(result.blob);
      setPreviewUrl(url);
      stopCamera();
    } else {
      toast({ title: 'Capture failed', description: 'Could not capture photo. Please try again.', variant: 'destructive' });
    }
  }, [stopCamera, toast]);

  const retryGps = useCallback(async () => {
    if (!capturedBlob) return;
    setGpsRetryLoading(true);
    try {
      const geo = await captureGeolocation();
      const updatedBlob = await reapplyGeotagToBlob(capturedBlob, geo);
      setCapturedGeo(geo);
      setCapturedBlob(updatedBlob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(updatedBlob));
      if (geo) {
        toast({ title: 'GPS captured', description: 'Location attached to this photo.' });
      } else {
        toast({ title: 'GPS unavailable', description: 'Could not get location. Enable location permission and try again.', variant: 'destructive' });
      }
    } finally {
      setGpsRetryLoading(false);
    }
  }, [capturedBlob, previewUrl, toast]);

  // -------------------------------------------------------------------------
  // File upload handling (drag & drop + click)
  // -------------------------------------------------------------------------

  const handleFileSelect = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast({
          title: 'Invalid File Type',
          description: 'Please select an image (JPG, PNG, GIF, WebP) or a PDF.',
          variant: 'destructive',
        });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: 'File Too Large',
          description: 'Maximum file size is 10 MB.',
          variant: 'destructive',
        });
        return;
      }
      setCapturedBlob(null);
      setCapturedGeo(null);
      setSelectedFile(file);
      if (file.type.startsWith('image/')) {
        setPreviewUrl(URL.createObjectURL(file));
      } else {
        setPreviewUrl(null);
      }
    },
    [toast]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const onBrowseClick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_TYPES.join(',');
    input.onchange = (ev) => {
      const target = ev.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) handleFileSelect(file);
    };
    input.click();
  }, [handleFileSelect]);

  // -------------------------------------------------------------------------
  // AI Smart Upload: auto-advance to AI input when file is ready
  // -------------------------------------------------------------------------

  useEffect(() => {
    const hasFileReady = !!(capturedBlob || selectedFile);
    if (hasFileReady && aiStep === 'idle') {
      setAiStep('ai_input');
    }
  }, [capturedBlob, selectedFile, aiStep]);

  // -------------------------------------------------------------------------
  // AI Smart Upload: parse instruction with Gemini
  // -------------------------------------------------------------------------

  const parseWithAI = useCallback(async (instruction: string): Promise<AiParseResult> => {
    const systemPrompt = `You extract file metadata from a user instruction about a medical document upload.
Return ONLY valid JSON with these fields:
{
  "patientName": string or null,
  "patientId": string or null,
  "category": one of "treatment_sheet"|"monitor_chart"|"dialysis"|"lab_investigation"|"radiology_investigation"|"ot_notes"|"ot_photos"|"implant_invoice"|"implant_sticker"|"discharge_summary"|"report"|"prescription"|"opd_summary"|"xray"|"mri_report"|"ct_scan_report"|"document"|"photo"|"id_proof" or null,
  "notes": string or null
}

Category mapping hints:
- Monitor chart, vitals chart, ICU chart: "monitor_chart"
- Dialysis sheet, dialysis chart, hemodialysis record: "dialysis"
- Lab investigation, blood test, pathology: "lab_investigation"
- Radiology investigation, radiology file: "radiology_investigation"
- OT notes: "ot_notes"
- OT photos, operation theatre photos: "ot_photos"
- Implant invoice: "implant_invoice"
- Implant sticker: "implant_sticker"
- Discharge summary: "discharge_summary"
- MRI report: "mri_report"
- CT scan report: "ct_scan_report"
- OPD summary, OPD consultation: "opd_summary"
- Aadhaar card, PAN card, voter ID, driving license, passport → "id_proof"
- X-ray, CT scan, MRI → "xray"
- Blood test, lab report, pathology → "report"
- Treatment sheet, treatment chart, medication chart, drug chart, nursing chart → "treatment_sheet"
- Prescription, medication list, doctor prescription → "prescription"
- Referral letter, consent form → "document"
- Patient photo, wound photo → "photo"

Extract patient name if mentioned. Extract any ID/UHID if mentioned. Put the document type description in "notes".`;

    let content: string;
    if (LLM_BACKEND === 'vps') {
      content = await callVpsClaude(systemPrompt + '\n\n' + instruction);
    } else {
      // Low-grade text->JSON task: route to the cheaper lite model.
      const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL_LITE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt + '\n\n' + instruction }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 200 },
        }),
      });
      const data = await response.json();
      content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');
    return JSON.parse(jsonMatch[0]) as AiParseResult;
  }, []);

  // -------------------------------------------------------------------------
  // AI Smart Upload: orchestrate AI analysis + patient search
  // -------------------------------------------------------------------------

  const handleAiAnalyze = useCallback(async () => {
    if (!aiInstruction.trim()) {
      toast({ title: 'Please describe the file', description: 'e.g., "Aadhaar card of Santlal Patel"', variant: 'destructive' });
      return;
    }

    setAiStep('ai_loading');
    setAiLoading(true);

    try {
      const parsed = await parseWithAI(aiInstruction);
      setAiParsed(parsed);

      // Auto-fill category
      if (parsed.category) setCategory(parsed.category);

      // Auto-fill notes
      if (parsed.notes) setNotes(parsed.notes);

      // Search for patient in DB
      const searchTerm = parsed.patientName || parsed.patientId;
      if (searchTerm) {
        const { data } = await (supabase as any)
          .from('patients')
          .select('id, name')
          .or(`name.ilike.%${searchTerm}%,patients_id.ilike.%${searchTerm}%`)
          .limit(5);

        if (data && data.length > 0) {
          setSelectedPatient(data[0] as PatientResult);
          setPatientSearch(data[0].name);
        } else {
          setSelectedPatient(null);
          setPatientSearch(searchTerm);
        }
      }

      setAiStep('ai_confirm');
    } catch (err) {
      console.error('AI parse error:', err);
      toast({ title: 'AI could not parse', description: 'Falling back to manual form. Your text has been preserved.', variant: 'destructive' });
      setNotes(aiInstruction);
      setAiStep('manual');
    } finally {
      setAiLoading(false);
    }
  }, [aiInstruction, parseWithAI, toast]);

  // -------------------------------------------------------------------------
  // AI Smart Upload: voice input via Web Speech API
  // -------------------------------------------------------------------------

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setAiInstruction((prev) => (prev ? prev + ' ' + transcript : transcript));
      setIsListening(false);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // -------------------------------------------------------------------------
  // Clear / reset state
  // -------------------------------------------------------------------------

  const clearCapture = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedBlob(null);
    setCapturedGeo(null);
    setGpsRetryLoading(false);
    setSelectedFile(null);
    setPreviewUrl(null);
    setPatientSearch('');
    setPatientResults([]);
    setSelectedPatient(null);
    setCategory('treatment_sheet');
    setNotes('');
    setAiStep('idle');
    setAiInstruction('');
    setAiParsed(null);
    setAiLoading(false);
    stopListening();
  }, [previewUrl, stopListening]);

  // -------------------------------------------------------------------------
  // Patient search
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (patientSearch.length < 2) {
      setPatientResults([]);
      setShowPatientDropdown(false);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('patients')
          .select('id, name, patients_id')
          .ilike('name', `%${patientSearch}%`)
          .limit(10);

        if (error) {
          console.error('Patient search error:', error);
          return;
        }

        // Enrich with latest visit_id for identification
        const patientIds = (data || []).map((p: any) => p.id);
        let visitMap: Record<string, string> = {};
        if (patientIds.length > 0) {
          const { data: visits } = await (supabase as any)
            .from('visits')
            .select('patient_id, visit_id')
            .in('patient_id', patientIds)
            .order('created_at', { ascending: false });
          if (visits) {
            for (const v of visits) {
              if (!visitMap[v.patient_id]) visitMap[v.patient_id] = v.visit_id;
            }
          }
        }

        const enriched = (data || []).map((p: any) => ({
          ...p,
          latest_visit_id: visitMap[p.id] || undefined
        }));

        setPatientResults(enriched as PatientResult[]);
        setShowPatientDropdown(true);
      } catch (e) {
        console.error('Patient search error:', e);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [patientSearch]);

  // -------------------------------------------------------------------------
  // Parse medicines when prescription modal opens
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (showPrescriptionModal && prescriptionResult) {
      const jsonMatch = prescriptionResult.match(/===JSON===\s*([\s\S]*?)\s*===END_JSON===/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          setReviewMedicines(parsed.map((m: any) => ({
            name: m.name || '',
            generic_name: (m.generic_name || '').toUpperCase(),
            brand_name: m.brand_name || '',
            strength: m.strength || '',
            route: m.route || 'Oral',
            frequency: m.frequency || 'OD',
            duration: m.duration || '',
            instructions: m.instructions || '',
            qty: 3,
            checked: true,
          })));
        } catch(e) { console.error('Parse error:', e); }
      }
      setPrescriptionStep('review');
    }
  }, [showPrescriptionModal, prescriptionResult]);

  // -------------------------------------------------------------------------
  // Prescription transcription using Gemini Vision
  // -------------------------------------------------------------------------

  const transcribePrescription = useCallback(async (imageBlob: Blob): Promise<string | null> => {
    // Downscale before encoding to keep vision token cost in check.
    const { base64, mimeType } = await downscaleImageForVision(imageBlob);

    const systemPrompt = `You are an expert pharmacist and medical transcription specialist. Analyze this prescription image and extract ALL medicines listed.

Return the prescription in this EXACT format:

PRESCRIPTION
============
Patient: [name if visible, otherwise "As per records"]
Date: [date if visible, otherwise today's date]
Doctor: [doctor name if visible]

Medicines:
1. [Medicine Name] - [Strength/Dose] - [Route] - [Frequency] - [Duration]
2. [Medicine Name] - [Strength/Dose] - [Route] - [Frequency] - [Duration]
...

Instructions:
- [Any special instructions visible on the prescription]

Notes:
- [Any additional notes]

Rules:
- Extract EVERY medicine visible in the prescription
- Include strength (e.g., 500mg, 10mg)
- Include route (Oral, IV, IM, Topical, etc.)
- Include frequency (OD=once daily, BD=twice daily, TDS=thrice daily, QID=four times daily, SOS=as needed, HS=at bedtime)
- Include duration (e.g., 5 days, 7 days, 2 weeks)
- If any field is not clearly visible, write "as directed"
- Use standard medical abbreviations`;

    if (LLM_BACKEND === 'vps') {
      // Vision on VPS Claude Opus (subscription auth). No fallback: a VPS error
      // throws and is surfaced by the caller's catch.
      return (await callVpsClaude(systemPrompt, 'opus', [{ base64, mimeType }])) || null;
    }

    const response = await geminiFetch(geminiGenerateContentUrl(''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
      }),
    });

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }, [toast]);

  const savePrescriptionToPatient = useCallback(async (transcribedText: string) => {
    if (!selectedPatient?.id || !transcribedText) return;

    setSavingPrescription(true);
    try {
      // Save as a note/prescription record in file_uploads (update the most recent upload's notes)
      const { data: recentUpload } = await (supabase as any)
        .from('file_uploads')
        .select('id')
        .eq('patient_id', selectedPatient.id)
        .eq('category', 'prescription')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (recentUpload) {
        await (supabase as any)
          .from('file_uploads')
          .update({ notes: transcribedText })
          .eq('id', recentUpload.id);
      }

      toast({
        title: 'Prescription Saved',
        description: `Transcribed prescription saved for ${selectedPatient.name}.`,
      });
      setShowPrescriptionModal(false);
      setPrescriptionResult(null);
    } catch (e) {
      console.error('Error saving prescription:', e);
      toast({ title: 'Save Failed', description: 'Could not save prescription.', variant: 'destructive' });
    } finally {
      setSavingPrescription(false);
    }
  }, [selectedPatient, toast]);

  // -------------------------------------------------------------------------
  // Treatment Sheet: extract medicines as structured JSON using Gemini Vision
  // -------------------------------------------------------------------------

  const transcribeTreatmentSheet = useCallback(async (imageBlob: Blob): Promise<string | null> => {
    // Downscale before encoding to keep vision token cost in check.
    const { base64, mimeType } = await downscaleImageForVision(imageBlob);

    const systemPrompt = `You are an expert pharmacist analyzing a hospital treatment sheet / medication chart image.

Extract ALL medicines listed in this treatment sheet.

Return the result in this EXACT format:

TREATMENT SHEET EXTRACTED
=========================
Patient: [name if visible, otherwise "As per records"]
Date: [date if visible]
Doctor: [doctor name if visible]

Medicines:
1. [Medicine Name] - [Strength/Dose] - [Route] - [Frequency] - [Duration] - [Special Instructions]
2. [Medicine Name] - [Strength/Dose] - [Route] - [Frequency] - [Duration] - [Special Instructions]
...

ALSO return a JSON block at the end in this format (after the text):
===JSON===
[
  {"name": "Medicine Name", "generic_name": "PARACETAMOL", "brand_name": "Dolo 650", "strength": "500mg", "route": "Oral", "frequency": "BD", "duration": "5 days", "instructions": "after food"},
  ...
]
===END_JSON===

Rules:
- Extract EVERY medicine visible, even if partially legible
- Include IV fluids, injections, tablets, syrups, everything
- Frequency codes: OD=once daily, BD=twice daily, TDS=thrice daily, QID=4 times, SOS=as needed, HS=bedtime, STAT=immediately
- Route: Oral, IV, IM, SC, Topical, Inhaler, Nebulization, etc.
- If any field is unclear, write "as directed"
- The JSON block must be valid JSON
- IMPORTANT: For each medicine, identify the generic/molecule name (e.g. PARACETAMOL, AMOXICILLIN+CLAVULANATE) and the brand name (e.g. Dolo 650, Augmentin). Put molecule in "generic_name" in UPPERCASE and brand in "brand_name". For combination drugs, list all molecules separated by + (e.g. "AMOXICILLIN+CLAVULANATE"). If only brand is visible, still try to identify the generic molecule. If only generic is visible, leave brand_name empty.`;

    if (LLM_BACKEND === 'vps') {
      return (await callVpsClaude(systemPrompt, 'opus', [{ base64, mimeType }])) || null;
    }

    const response = await geminiFetch(geminiGenerateContentUrl(''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4000 },
      }),
    });

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }, [toast]);

  // Save extracted treatment sheet medicines as a prescription (visit_medications)
  const saveExtractedMedicines = useCallback(async (transcribedText: string) => {
    if (!selectedPatient?.id || !transcribedText) return;

    setSavingPrescription(true);
    try {
      // Extract JSON block from the transcribed text
      const jsonMatch = transcribedText.match(/===JSON===\s*([\s\S]*?)\s*===END_JSON===/);
      let medicines: { name: string; strength?: string; route?: string; frequency?: string; duration?: string; instructions?: string }[] = [];

      if (jsonMatch) {
        try {
          medicines = JSON.parse(jsonMatch[1]);
        } catch (e) {
          console.error('Failed to parse medicines JSON:', e);
        }
      }

      // Get the patient's latest visit
      const { data: visitData } = await (supabase as any)
        .from('visits')
        .select('id, visit_id')
        .eq('patient_id', selectedPatient.id)
        .order('admission_date', { ascending: false })
        .limit(1)
        .single();

      if (!visitData) {
        toast({ title: 'No Visit Found', description: 'Could not find an active visit for this patient. Prescription text saved to notes only.', variant: 'destructive' });
        // Still save the text transcription to file_uploads notes
        const { data: recentUpload } = await (supabase as any)
          .from('file_uploads')
          .select('id')
          .eq('patient_id', selectedPatient.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (recentUpload) {
          await (supabase as any).from('file_uploads').update({ notes: transcribedText }).eq('id', recentUpload.id);
        }
        setShowPrescriptionModal(false);
        setPrescriptionResult(null);
        return;
      }

      // Insert medicines into visit_medications
      if (medicines.length > 0) {
        const medsToInsert = medicines.map(med => ({
          visit_id: visitData.id,
          medication_name: med.name || 'Unknown',
          dosage: med.strength || '',
          route: med.route || 'Oral',
          frequency: med.frequency || 'OD',
          duration: med.duration || '',
          special_instructions: med.instructions || '',
          prescribed_date: new Date().toISOString(),
          status: 'active',
        }));

        const { error: insertError } = await (supabase as any)
          .from('visit_medications')
          .insert(medsToInsert);

        if (insertError) {
          console.error('Error inserting medications:', insertError);
          toast({ title: 'Partial Save', description: `Extracted ${medicines.length} medicines but failed to save to visit: ${insertError.message}. Text saved to notes.`, variant: 'destructive' });
        } else {
          toast({
            title: 'Prescription Created!',
            description: `${medicines.length} medicines extracted from treatment sheet and saved to ${selectedPatient.name}'s visit.`,
          });
        }
      }

      // Also save full text to file_uploads notes
      const { data: recentUpload } = await (supabase as any)
        .from('file_uploads')
        .select('id')
        .eq('patient_id', selectedPatient.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (recentUpload) {
        await (supabase as any).from('file_uploads').update({ notes: transcribedText }).eq('id', recentUpload.id);
      }

      setShowPrescriptionModal(false);
      setPrescriptionResult(null);
    } catch (e) {
      console.error('Error saving extracted medicines:', e);
      toast({ title: 'Save Failed', description: 'Could not save prescription.', variant: 'destructive' });
    } finally {
      setSavingPrescription(false);
    }
  }, [selectedPatient, toast]);

  // -------------------------------------------------------------------------
  // OPD Summary: extract patient & consultation data using Gemini Vision
  // -------------------------------------------------------------------------

  const transcribeOpdSummary = useCallback(async (imageBlob: Blob): Promise<OpdExtractedData | null> => {
    // Downscale before encoding to keep vision token cost in check.
    const { base64, mimeType } = await downscaleImageForVision(imageBlob);

    const systemPrompt = `You are an expert medical records analyst. Analyze this OPD (Out-Patient Department) consultation summary/slip image and extract ALL patient and consultation information.

Return ONLY a valid JSON object (no markdown, no code fences, no extra text) in this EXACT format:
{
  "patientName": "Patient full name or empty string if not visible",
  "age": "Age with unit e.g. '45 years' or empty string",
  "gender": "Male/Female/Other or empty string",
  "phone": "Phone number or empty string",
  "chiefComplaint": "Main complaint/reason for visit",
  "diagnosis": "Diagnosis if mentioned",
  "doctorName": "Consulting doctor name",
  "vitals": {
    "bp": "Blood pressure e.g. 120/80 mmHg or empty string",
    "pulse": "Pulse rate or empty string",
    "temperature": "Temperature or empty string",
    "weight": "Weight or empty string",
    "spo2": "SpO2 or empty string"
  },
  "medicines": ["Medicine 1 - dose - frequency", "Medicine 2 - dose - frequency"],
  "advice": "Doctor advice/instructions",
  "followUp": "Follow-up date or instructions"
}

Rules:
- Extract EVERY piece of information visible in the image
- If a field is not visible, use an empty string ""
- For medicines, include dose and frequency if visible
- Return ONLY the JSON object, nothing else`;

    let text: string;
    if (LLM_BACKEND === 'vps') {
      text = (await callVpsClaude(systemPrompt, 'opus', [{ base64, mimeType }])) || '';
    } else {
      const response = await geminiFetch(geminiGenerateContentUrl(''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: systemPrompt },
              { inline_data: { mime_type: mimeType, data: base64 } }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
        }),
      });

      const data = await response.json();
      text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    try {
      // Strip markdown code fences if present
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned) as OpdExtractedData;
    } catch (e) {
      console.error('Failed to parse OPD extraction JSON:', e, text);
      toast({ title: 'Extraction Partial', description: 'Could not fully parse OPD data. Please enter details manually.', variant: 'destructive' });
      return null;
    }
  }, [toast]);

  /** Save OPD extracted data: find/create patient, create OPD visit, navigate to profile */
  const handleSaveOpdSummary = useCallback(async () => {
    if (!opdExtracted) return;
    setSavingOpd(true);

    try {
      const today = new Date().toISOString().split('T')[0];

      // Step 1: Find or create patient
      let patientId: string | null = null;
      let visitId: string | null = null;

      // If a patient was selected from search, use that
      if (prescriptionPatient?.id) {
        patientId = prescriptionPatient.id;
      } else if (opdExtracted.patientName) {
        // Search for existing patient by name
        const { data: existing } = await (supabase as any)
          .from('patients')
          .select('id, patients_id')
          .ilike('name', opdExtracted.patientName.trim())
          .limit(1)
          .single();

        if (existing) {
          patientId = existing.id;
        } else {
          // Create new patient
          const { data: newPatient, error: patientError } = await (supabase as any)
            .from('patients')
            .insert({
              name: opdExtracted.patientName.trim(),
              age: parseInt(opdExtracted.age) || null,
              gender: opdExtracted.gender || null,
              phone: opdExtracted.phone || null,
              hospital_name: (hospitalConfig as any)?.name || null,
            })
            .select('id, patients_id')
            .single();

          if (patientError) {
            console.error('Error creating patient:', patientError);
            toast({ title: 'Error', description: 'Could not create patient record.', variant: 'destructive' });
            setSavingOpd(false);
            return;
          }
          patientId = newPatient.id;
        }
      }

      // Step 2: Create OPD visit
      if (patientId) {
        const visitPayload: Record<string, unknown> = {
          patient_id: patientId,
          patient_type: 'OPD',
          visit_type: 'Consultation',
          visit_date: today,
          appointment_with: opdExtracted.doctorName || 'Doctor',
          status: 'active',
          notes: [
            opdExtracted.chiefComplaint ? `Chief Complaint: ${opdExtracted.chiefComplaint}` : '',
            opdExtracted.diagnosis ? `Diagnosis: ${opdExtracted.diagnosis}` : '',
            opdExtracted.advice ? `Advice: ${opdExtracted.advice}` : '',
            opdExtracted.followUp ? `Follow-up: ${opdExtracted.followUp}` : '',
            opdExtracted.vitals.bp ? `BP: ${opdExtracted.vitals.bp}` : '',
            opdExtracted.vitals.pulse ? `Pulse: ${opdExtracted.vitals.pulse}` : '',
            opdExtracted.vitals.temperature ? `Temp: ${opdExtracted.vitals.temperature}` : '',
            opdExtracted.vitals.weight ? `Weight: ${opdExtracted.vitals.weight}` : '',
            opdExtracted.vitals.spo2 ? `SpO2: ${opdExtracted.vitals.spo2}` : '',
            opdExtracted.medicines.length > 0 ? `Medicines: ${opdExtracted.medicines.join(', ')}` : '',
          ].filter(Boolean).join('\n'),
        };

        const { data: visitData, error: visitError } = await (supabase as any)
          .from('visits')
          .insert(visitPayload)
          .select('id, visit_id')
          .single();

        if (visitError) {
          console.error('Error creating visit:', visitError);
          toast({
            title: 'Visit Save Failed',
            description: visitError.message || 'Could not create OPD visit row.',
            variant: 'destructive',
          });
          setSavingOpd(false);
          return;
        }
        visitId = visitData.visit_id || visitData.id;
      }

      toast({
        title: 'OPD Summary Saved',
        description: `${opdExtracted.patientName || 'Patient'} consultation recorded successfully.`,
      });

      // Format extracted OPD data as text for Panel 1
      const opdNotesText = [
        opdExtracted.patientName ? `Patient: ${opdExtracted.patientName}` : '',
        opdExtracted.age ? `Age: ${opdExtracted.age}` : '',
        opdExtracted.gender ? `Gender: ${opdExtracted.gender}` : '',
        opdExtracted.doctorName ? `Doctor: ${opdExtracted.doctorName}` : '',
        '',
        opdExtracted.chiefComplaint ? `Chief Complaint: ${opdExtracted.chiefComplaint}` : '',
        opdExtracted.diagnosis ? `Diagnosis: ${opdExtracted.diagnosis}` : '',
        '',
        (opdExtracted.vitals.bp || opdExtracted.vitals.pulse || opdExtracted.vitals.temperature || opdExtracted.vitals.weight || opdExtracted.vitals.spo2) ? 'Vitals:' : '',
        opdExtracted.vitals.bp ? `  BP: ${opdExtracted.vitals.bp}` : '',
        opdExtracted.vitals.pulse ? `  Pulse: ${opdExtracted.vitals.pulse}` : '',
        opdExtracted.vitals.temperature ? `  Temperature: ${opdExtracted.vitals.temperature}` : '',
        opdExtracted.vitals.weight ? `  Weight: ${opdExtracted.vitals.weight}` : '',
        opdExtracted.vitals.spo2 ? `  SpO2: ${opdExtracted.vitals.spo2}` : '',
        '',
        opdExtracted.medicines.length > 0 ? `Medicines:\n${opdExtracted.medicines.map(m => `  - ${m}`).join('\n')}` : '',
        '',
        opdExtracted.advice ? `Advice: ${opdExtracted.advice}` : '',
        opdExtracted.followUp ? `Follow-up: ${opdExtracted.followUp}` : '',
      ].filter(line => line !== '').join('\n');

      // Store in localStorage so DischargeSummaryEdit can pick it up in Panel 1
      localStorage.setItem('opd_extracted_notes', opdNotesText);

      setShowOpdModal(false);
      setOpdExtracted(null);

      // Navigate to discharge summary edit page with the visit
      if (visitId) {
        onOpenChange?.(false);
        navigate(`/discharge-summary-edit/${visitId}`);
      } else if (patientId) {
        onOpenChange?.(false);
        navigate(`/patient-profile?patient=${patientId}`);
      }
    } catch (e) {
      console.error('Error saving OPD summary:', e);
      toast({ title: 'Save Failed', description: 'Could not save OPD summary.', variant: 'destructive' });
    } finally {
      setSavingOpd(false);
    }
  }, [opdExtracted, prescriptionPatient, toast, navigate, onOpenChange]);

  // -------------------------------------------------------------------------
  // Upload logic
  // -------------------------------------------------------------------------

  const handleUpload = useCallback(async () => {
    const fileToUpload = capturedBlob || selectedFile;
    if (!fileToUpload) {
      toast({
        title: 'No File',
        description: 'Please capture a photo or select a file first.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    try {
      const raw = localStorage.getItem('hmis_user');
      const user = raw ? JSON.parse(raw) : null;

      let uploadBlob = fileToUpload;
      let uploadGeo = capturedBlob ? capturedGeo : null;
      const uploadSource = capturedBlob ? 'in_app_camera' : 'file_picker';

      // Determine file name
      let fileName = selectedFile
        ? selectedFile.name
        : `capture_${Date.now()}.jpg`;
      let fileType = selectedFile?.type || 'image/jpeg';

      if (selectedFile && selectedFile.type.startsWith('image/')) {
        uploadGeo = await captureGeolocation();
        const stamped = await stampGeotagOnImage(selectedFile, uploadGeo, {
          fileName,
          fileType: selectedFile.type,
          placeLabel: `${hospitalConfig.fullName}, ${hospitalConfig.contactInfo.address}, India`,
        });
        uploadBlob = stamped.blob;
        fileName = stamped.fileName;
        fileType = stamped.fileType;
      }

      const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `uploads/${Date.now()}_${sanitizedName}`;

      // Upload to Supabase Storage bucket "uploads"
      const { error: storageError } = await (supabase as any).storage
        .from('uploads')
        .upload(storagePath, uploadBlob, { contentType: fileType });

      if (storageError) {
        console.error('Storage upload error:', storageError);
        toast({
          title: 'Upload Failed',
          description: storageError.message || 'Could not upload file to storage.',
          variant: 'destructive',
        });
        setUploading(false);
        return;
      }

      // Get public URL
      const { data: urlData } = (supabase as any).storage
        .from('uploads')
        .getPublicUrl(storagePath);

      const publicUrl = urlData?.publicUrl || '';

      // Save metadata to file_uploads table
      const { error: insertError } = await (supabase as any)
        .from('file_uploads')
        .insert({
          file_name: fileName,
          file_url: publicUrl,
          file_type: fileType,
          file_size: uploadBlob.size,
          storage_path: storagePath,
          category,
          patient_id: selectedPatient?.id || null,
          patient_name: selectedPatient?.name || null,
          notes: notes || null,
          uploaded_by: user?.id || null,
          ...geoToDbFields(uploadGeo, uploadSource),
        });

      if (insertError) {
        console.error('Metadata insert error:', insertError);
        toast({
          title: 'Upload Failed',
          description: insertError.message || 'Could not save file metadata.',
          variant: 'destructive',
        });
        setUploading(false);
        return;
      }

      // Log activity
      await logActivity('file_upload', { fileName, category });

      toast({
        title: 'Upload Successful',
        description: `${fileName} has been uploaded successfully.`,
      });

      if (selectedPatient?.id) {
        queryClient.invalidateQueries({ queryKey: ['bill-patient-docs', selectedPatient.id] });
        queryClient.invalidateQueries({ queryKey: ['tablet-patient-docs', selectedPatient.id, category] });
      }

      // If category is prescription or treatment_sheet and patient is selected, transcribe
      if ((category === 'prescription' || category === 'treatment_sheet') && selectedPatient) {
        // CRITICAL: Save patient info BEFORE clearCapture() wipes selectedPatient
        setPrescriptionPatient({ ...selectedPatient });
        // Remember the uploaded source image so it can be linked to the prescription
        setPrescriptionImageUrl(publicUrl);
        setPrescriptionImageType(fileType);

        // Auto-fill doctor name from latest visit
        try {
          const { data: visitData } = await (supabase as any)
            .from('visits')
            .select('referring_doctor, doctor_name')
            .eq('patient_id', selectedPatient.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (visitData) {
            const doctorName = visitData.referring_doctor || visitData.doctor_name || '';
            if (doctorName) setPrescriptionDoctor(doctorName);
          }
        } catch (e) {
          // Non-fatal — doctor name can be entered manually
        }

        setTranscribing(true);
        try {
          const transcription = category === 'treatment_sheet'
            ? await transcribeTreatmentSheet(fileToUpload)
            : await transcribePrescription(fileToUpload);
          if (transcription) {
            setPrescriptionResult(transcription);
            setShowPrescriptionModal(true);
          }
        } catch (err) {
          console.error('Transcription error:', err);
          toast({ title: 'Transcription Failed', description: 'Could not transcribe document. File was uploaded successfully.', variant: 'destructive' });
        } finally {
          setTranscribing(false);
        }
      }

      // If category is opd_summary, extract OPD consultation data
      if (category === 'opd_summary') {
        if (selectedPatient) {
          setPrescriptionPatient({ ...selectedPatient });
        }
        setTranscribing(true);
        try {
          const extracted = await transcribeOpdSummary(fileToUpload);
          if (extracted) {
            setOpdExtracted(extracted);
            setShowOpdModal(true);
          }
        } catch (err) {
          console.error('OPD extraction error:', err);
          toast({ title: 'Extraction Failed', description: 'Could not extract OPD data. File was uploaded successfully.', variant: 'destructive' });
        } finally {
          setTranscribing(false);
        }
      }

      // Reset form and refresh gallery
      clearCapture();
      fetchRecentUploads();
    } catch (e) {
      console.error('Upload error:', e);
      toast({
        title: 'Upload Failed',
        description: 'An unexpected error occurred during upload.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  }, [
    capturedBlob,
    capturedGeo,
    selectedFile,
    category,
    notes,
    selectedPatient,
    toast,
    clearCapture,
    fetchRecentUploads,
    transcribePrescription,
    transcribeTreatmentSheet,
    transcribeOpdSummary,
    queryClient,
  ]);

  // -------------------------------------------------------------------------
  // Determine if a file/capture is ready for the metadata form
  // -------------------------------------------------------------------------

  const hasFile = !!(capturedBlob || selectedFile);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderCategorySelectOptions = () => (
    <>
      <SelectGroup>
        <SelectLabel className="text-xs text-gray-500">Bill Documents</SelectLabel>
        {BILL_DOCUMENT_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectGroup>
      <SelectSeparator />
      <SelectGroup>
        <SelectLabel className="text-xs text-gray-500">Clinical Uploads</SelectLabel>
        {CLINICAL_UPLOAD_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectGroup>
    </>
  );

  /** Camera section */
  const renderCamera = () => (
    <div className="space-y-3">
      {!cameraActive && !hasFile && (
        <Button
          variant="outline"
          className="w-full h-24 border-dashed border-2 border-blue-300 hover:border-blue-500 hover:bg-blue-50"
          onClick={startCamera}
        >
          <Camera className="h-8 w-8 mr-2 text-blue-500" />
          <span className="text-blue-600 font-medium">Start Camera</span>
        </Button>
      )}

      {cameraActive && (
        <div className="space-y-2">
          <div className="relative rounded-lg overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-lg"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={capturePhoto} className="flex-1 bg-blue-600 hover:bg-blue-700">
              <Camera className="h-4 w-4 mr-2" />
              Capture
            </Button>
            <Button variant="outline" onClick={switchCamera}>
              <SwitchCamera className="h-4 w-4 mr-1" />
              Switch
            </Button>
            <Button variant="outline" onClick={stopCamera}>
              <StopCircle className="h-4 w-4 mr-1" />
              Stop
            </Button>
          </div>
        </div>
      )}

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );

  /** File upload drop zone */
  const renderDropZone = () => {
    if (cameraActive || hasFile) return null;

    return (
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
        }`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onBrowseClick}
      >
        <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-600 font-medium">
          Drag & drop a file here, or click to browse
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Images (JPG, PNG, GIF, WebP) or PDF -- Max 10 MB
        </p>
      </div>
    );
  };

  /** Preview of captured photo or selected file */
  const renderPreview = () => {
    if (!hasFile) return null;

    const isPdf = selectedFile?.type === 'application/pdf';
    const displayName = selectedFile?.name || 'captured_photo.jpg';
    const displaySize = formatSize(
      selectedFile?.size || capturedBlob?.size || 0
    );

    return (
      <div className="space-y-3">
        <div className="relative rounded-lg overflow-hidden border border-gray-200">
          {previewUrl && !isPdf ? (
            <img
              src={previewUrl}
              alt="Preview"
              className="w-full max-h-64 object-contain bg-gray-50"
            />
          ) : (
            <div className="flex items-center justify-center p-8 bg-gray-50">
              <FileText className="h-16 w-16 text-blue-400" />
            </div>
          )}
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8"
            onClick={clearCapture}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          {isPdf ? (
            <FileText className="h-4 w-4 text-red-500" />
          ) : (
            <Image className="h-4 w-4 text-blue-500" />
          )}
          <span className="truncate">{displayName}</span>
          <span className="text-gray-400">({displaySize})</span>
        </div>
        {capturedBlob && (
          <GeotagStatus
            geo={capturedGeo}
            loading={gpsRetryLoading}
            onRetry={retryGps}
          />
        )}
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Quick Setup: patient + category shown immediately when file is ready
  // -------------------------------------------------------------------------

  const renderQuickSetup = () => {
    if (!hasFile) return null;
    // Don't show in manual mode (it has its own patient/category fields)
    if (aiStep === 'manual') return null;

    return (
      <div className="space-y-3 pt-2 pb-1 border-b border-gray-200 mb-2">
        {/* Patient search */}
        <div className="space-y-1 relative">
          <Label className="text-xs font-semibold text-gray-600">Patient</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder="Search patient name..."
              value={selectedPatient ? selectedPatient.name : patientSearch}
              onChange={(e) => {
                setPatientSearch(e.target.value);
                setSelectedPatient(null);
              }}
              className="pl-8 h-8 text-sm"
            />
          </div>
          {showPatientDropdown && patientResults.length > 0 && !selectedPatient && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-32 overflow-y-auto">
              {patientResults.map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex justify-between items-center"
                  onClick={() => {
                    setSelectedPatient(p);
                    setPatientSearch(p.name);
                    setShowPatientDropdown(false);
                  }}
                >
                  <span>{p.name}</span>
                  <span className="text-[10px] text-gray-400 ml-2">{p.latest_visit_id || p.patients_id || ''}</span>
                </button>
              ))}
            </div>
          )}
          {selectedPatient && (
            <Badge variant="secondary" className="text-[10px] mt-1">Patient linked: {selectedPatient.name} {selectedPatient.patients_id ? `(${selectedPatient.patients_id})` : ''}</Badge>
          )}
        </div>

        {/* Category */}
        <div className="space-y-1">
          <Label className="text-xs font-semibold text-gray-600">Document Type</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as UploadCategory)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {renderCategorySelectOptions()}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // AI Smart Upload render helpers
  // -------------------------------------------------------------------------

  const hasSpeechApi = typeof window !== 'undefined' && !!((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);

  /** AI Smart Input — text box + mic + Analyze button */
  const renderAiSmartInput = () => {
    if (!hasFile || aiStep !== 'ai_input') return null;

    return (
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-medium text-purple-700">AI Smart Upload</span>
        </div>
        <p className="text-xs text-gray-500">
          Describe the file — e.g., "Aadhaar card of Santlal Patel"
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="What is this file?"
            value={aiInstruction}
            onChange={(e) => setAiInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAiAnalyze(); }}
            className="flex-1"
          />
          {hasSpeechApi && (
            <Button
              variant="outline"
              size="icon"
              onClick={isListening ? stopListening : startListening}
              className={isListening ? 'border-red-400 text-red-500 animate-pulse' : ''}
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-purple-600 hover:bg-purple-700"
            onClick={handleAiAnalyze}
            disabled={!aiInstruction.trim()}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Analyze with AI
          </Button>
          <Button
            variant="outline"
            className="text-gray-600"
            onClick={() => setAiStep('manual')}
          >
            Fill manually
          </Button>
        </div>
      </div>
    );
  };

  /** AI Loading spinner */
  const renderAiLoading = () => {
    if (!hasFile || aiStep !== 'ai_loading') return null;

    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-3">
        <Loader2 className="h-8 w-8 text-purple-500 animate-spin" />
        <p className="text-sm text-gray-600">AI is analyzing your instruction...</p>
      </div>
    );
  };

  /** AI Confirmation panel — shows auto-detected values with edit controls */
  const renderAiConfirm = () => {
    if (!hasFile || aiStep !== 'ai_confirm') return null;

    return (
      <div className="space-y-4 pt-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium text-green-700">AI Results</span>
        </div>

        {/* Patient */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Patient</Label>
          {selectedPatient ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-green-700 font-medium">{selectedPatient.name}</span>
              {selectedPatient.patients_id && <span className="text-[10px] text-gray-500">({selectedPatient.patients_id})</span>}
              <Badge variant="secondary" className="text-[10px]">Matched</Badge>
              <button
                className="text-xs text-blue-500 hover:underline ml-auto"
                onClick={() => {
                  setSelectedPatient(null);
                  setAiStep('manual');
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-orange-600">
                {aiParsed?.patientName
                  ? `"${aiParsed.patientName}" — no match found`
                  : 'No patient detected'}
              </span>
              <button
                className="text-xs text-blue-500 hover:underline ml-auto"
                onClick={() => setAiStep('manual')}
              >
                Search manually
              </button>
            </div>
          )}
        </div>

        {/* Category */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as UploadCategory)}>
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {renderCategorySelectOptions()}
            </SelectContent>
          </Select>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Notes</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setAiStep('manual')}
          >
            Edit all
          </Button>
        </div>
      </div>
    );
  };

  /** Metadata form shown after capture / file selection */
  const renderMetadataForm = () => {
    if (!hasFile || aiStep !== 'manual') return null;

    return (
      <div className="space-y-4 pt-2">
        {/* Patient search */}
        <div className="space-y-1.5 relative">
          <Label className="text-sm font-medium">Patient Name</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search patient..."
              value={selectedPatient ? selectedPatient.name : patientSearch}
              onChange={(e) => {
                setPatientSearch(e.target.value);
                setSelectedPatient(null);
              }}
              className="pl-8"
            />
          </div>
          {showPatientDropdown && patientResults.length > 0 && !selectedPatient && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-40 overflow-y-auto">
              {patientResults.map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors"
                  onClick={() => {
                    setSelectedPatient(p);
                    setPatientSearch(p.name);
                    setShowPatientDropdown(false);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Category select */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as UploadCategory)}>
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {renderCategorySelectOptions()}
            </SelectContent>
          </Select>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Notes</Label>
          <Input
            placeholder="Optional notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Upload button */}
        <Button
          className="w-full bg-blue-600 hover:bg-blue-700"
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Upload className="h-4 w-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Upload
            </>
          )}
        </Button>
      </div>
    );
  };

  /** Recent uploads gallery */
  const renderRecentUploads = () => {
    if (recentUploads.length === 0) return null;

    const ROW_LIMIT = 3; // show 1 row (3 items on sm+)
    const visibleUploads = showAllUploads ? recentUploads : recentUploads.slice(0, ROW_LIMIT);
    const hasMore = recentUploads.length > ROW_LIMIT;

    return (
      <div className="space-y-2 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-700">Recent Uploads</h4>
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAllUploads(!showAllUploads)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              {showAllUploads ? 'Show Less' : `View More (${recentUploads.length})`}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {visibleUploads.map((upload) => {
            const isImage = upload.file_type?.startsWith('image/');
            return (
              <div
                key={upload.id}
                className="rounded-lg border border-gray-200 overflow-hidden bg-white hover:shadow-sm transition-shadow"
              >
                {isImage && upload.file_url ? (
                  <img
                    src={upload.file_url}
                    alt={upload.file_name}
                    className="w-full h-20 object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-20 bg-gray-50">
                    <FileText className="h-8 w-8 text-gray-400" />
                  </div>
                )}
                <div className="p-1.5">
                  <p className="text-xs truncate text-gray-700" title={upload.file_name}>
                    {upload.file_name}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {upload.category}
                    </Badge>
                    <span className="text-[10px] text-gray-400">
                      {timeAgo(upload.created_at)}
                    </span>
                  </div>
                  {upload.latitude != null && upload.longitude != null && (
                    <a
                      href={googleMapsUrl({ latitude: upload.latitude, longitude: upload.longitude, accuracy: null, capturedAt: '' })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-emerald-700 hover:underline mt-0.5 block truncate"
                    >
                      GPS: {upload.latitude.toFixed(4)}, {upload.longitude.toFixed(4)}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Main content
  // -------------------------------------------------------------------------

  /** Prescription / Treatment Sheet transcription modal */
  const isTreatmentSheet = category === 'treatment_sheet';
  const hasJsonMedicines = prescriptionResult?.includes('===JSON===');

  const handleGeneratePrescription = async () => {
    const checkedMedicines = reviewMedicines.filter(m => m.checked);
    if (checkedMedicines.length === 0) {
      toast({ title: 'No Medicines Selected', description: 'Please select at least one medicine.', variant: 'destructive' });
      return;
    }

    setSavingPrescription(true);
    try {
      const prescriptionNumber = 'RX-' + Date.now();
      const today = new Date().toISOString().split('T')[0];

      // Insert prescription record
      const patientIdToSave = prescriptionPatient?.id || selectedPatient?.id || null;
      const patientNameToSave = prescriptionPatient?.name || selectedPatient?.name || 'Unknown';
      console.log('💊 [RX SAVE] Saving prescription for patient:', patientNameToSave, 'ID:', patientIdToSave);
      console.log('💊 [RX SAVE] prescriptionPatient:', prescriptionPatient?.id, prescriptionPatient?.name);
      console.log('💊 [RX SAVE] selectedPatient:', selectedPatient?.id, selectedPatient?.name);

      // The prescription_image_* columns need migration 20260516000001. If it
      // hasn't been applied yet, the insert is retried without them so creating
      // a prescription never hard-fails (the photo link is simply skipped).
      const rxPayload: Record<string, any> = {
        prescription_number: prescriptionNumber,
        patient_id: patientIdToSave,
        doctor_name: prescriptionDoctor || 'As per records',
        prescription_date: today,
        status: 'PENDING',
        notes: prescriptionResult || '',
        prescription_image_url: prescriptionImageUrl,
        prescription_image_type: prescriptionImageType,
      };

      let { data: rxData, error: rxError } = await (supabase as any)
        .from('prescriptions')
        .insert(rxPayload)
        .select('id')
        .single();

      if (rxError && /prescription_image_(url|type)/.test(rxError.message || '')) {
        console.warn(
          'prescription_image_* columns missing — saving without photo link. Apply migration 20260516000001.'
        );
        delete rxPayload.prescription_image_url;
        delete rxPayload.prescription_image_type;
        ({ data: rxData, error: rxError } = await (supabase as any)
          .from('prescriptions')
          .insert(rxPayload)
          .select('id')
          .single());
      }

      if (rxError) {
        console.error('Error inserting prescription:', rxError);
        toast({ title: 'Save Failed', description: rxError.message || 'Could not save prescription.', variant: 'destructive' });
        setSavingPrescription(false);
        return;
      }

      const prescriptionId = rxData?.id;

      // Insert prescription items
      if (prescriptionId) {
        const itemsToInsert = checkedMedicines.map(m => {
          const durationDays = parseInt(m.duration) || 0;
          return {
            prescription_id: prescriptionId,
            medicine_id: null,
            medicine_name: m.name || 'Unknown',
            generic_name: m.generic_name || '',
            brand_name: m.brand_name || '',
            quantity_prescribed: m.qty,
            dosage_frequency: m.frequency,
            dosage_timing: m.route,
            duration_days: durationDays,
            special_instructions: [m.instructions, m.strength].filter(Boolean).join(' | '),
          };
        });

        const { error: itemsError } = await (supabase as any)
          .from('prescription_items')
          .insert(itemsToInsert);

        if (itemsError) {
          console.error('Error inserting prescription items:', itemsError);
          // Non-fatal: prescription header was saved, items failed
        }
      }

      // Open print window
      const hospitalName = (hospitalConfig as any)?.name || 'Hope Multi-Specialty Hospital';
      const patientName = prescriptionPatient?.name || selectedPatient?.name || 'As per records';
      const doctorName = prescriptionDoctor || 'As per records';
      const printDate = new Date().toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

      const medicineRows = checkedMedicines.map((m, idx) => {
        const genericDisplay = m.generic_name ? m.generic_name.toUpperCase() : m.name.toUpperCase();
        const brandDisplay = m.brand_name ? `<div style="font-size:10px;color:#555;font-weight:normal;margin-top:1px;">(${m.brand_name})</div>` : '';
        return `
        <tr>
          <td>${idx + 1}</td>
          <td><strong style="font-size:13px;">${genericDisplay}</strong>${brandDisplay}</td>
          <td>${m.strength || '-'}</td>
          <td>${m.route || '-'}</td>
          <td>${m.frequency || '-'}</td>
          <td>${m.duration || '-'}</td>
          <td>${m.qty}</td>
        </tr>
      `;
      }).join('');

      const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Prescription - ${prescriptionNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #000; background: #fff; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 16px; }
    .hospital-name { font-size: 22px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
    .rx-title { font-size: 16px; font-weight: bold; letter-spacing: 3px; margin-top: 6px; color: #333; }
    .patient-info { display: flex; justify-content: space-between; margin-bottom: 14px; border: 1px solid #ccc; padding: 10px; border-radius: 4px; background: #f9f9f9; }
    .patient-info .col { flex: 1; }
    .patient-info .col p { margin-bottom: 4px; }
    .patient-info .col strong { font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #1a1a2e; color: #fff; padding: 8px 6px; font-size: 11px; text-align: left; }
    td { padding: 7px 6px; border-bottom: 1px solid #e0e0e0; font-size: 12px; vertical-align: top; }
    tr:nth-child(even) td { background: #f7f7f7; }
    .footer { margin-top: 30px; display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid #ccc; padding-top: 16px; }
    .signature-block { text-align: center; min-width: 180px; }
    .signature-line { border-top: 1px solid #000; margin-top: 40px; padding-top: 6px; font-size: 11px; }
    .stamp-block { text-align: center; min-width: 150px; }
    .stamp-box { width: 120px; height: 80px; border: 1px dashed #aaa; margin: 0 auto 6px; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 10px; }
    .rx-number { font-size: 10px; color: #666; text-align: right; margin-bottom: 4px; }
    @media print {
      body { padding: 10mm; }
      @page { size: A4; margin: 10mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="hospital-name">${hospitalName}</div>
    <div class="rx-title">PRESCRIPTION</div>
  </div>
  <div class="rx-number">Rx No: ${prescriptionNumber}</div>
  <div class="patient-info">
    <div class="col">
      <p><strong>Patient:</strong> ${patientName}</p>
      <p><strong>Date:</strong> ${today}</p>
    </div>
    <div class="col" style="text-align:right;">
      <p><strong>Doctor:</strong> ${doctorName}</p>
      <p><strong>Printed:</strong> ${printDate}</p>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:40px;">Sr.No</th>
        <th>MEDICINE NAME</th>
        <th style="width:80px;">STRENGTH</th>
        <th style="width:70px;">ROUTE</th>
        <th style="width:70px;">FREQUENCY</th>
        <th style="width:80px;">DURATION</th>
        <th style="width:40px;">QTY</th>
      </tr>
    </thead>
    <tbody>
      ${medicineRows}
    </tbody>
  </table>
  <div class="footer">
    <div class="signature-block">
      <div class="signature-line">Doctor's Signature</div>
    </div>
    <div class="stamp-block">
      <div class="stamp-box">Hospital Stamp</div>
      <div style="font-size:10px;color:#666;">Date: ${today}</div>
    </div>
  </div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

      // Store print HTML for on-demand printing (don't auto-print)
      setSavedPrintHtml(printHtml);
      setSavedPrescriptionNumber(prescriptionNumber);

      toast({ title: 'Prescription Saved!', description: `${prescriptionNumber} saved successfully. You can now print it.` });
      // Move to step 3 (saved confirmation) instead of closing
      setPrescriptionStep('saved');
    } catch (e) {
      console.error('Error generating prescription:', e);
      toast({ title: 'Error', description: 'Could not generate prescription.', variant: 'destructive' });
    } finally {
      setSavingPrescription(false);
    }
  };

  const renderPrescriptionModal = () => {
    const allChecked = reviewMedicines.length > 0 && reviewMedicines.every(m => m.checked);

    return (
      <Dialog open={showPrescriptionModal} onOpenChange={(open) => {
        if (!open) {
          setShowPrescriptionModal(false);
          setPrescriptionResult(null);
          setPrescriptionStep('review');
          setPrescriptionDoctor('');
          setReviewMedicines([]);
          setPrescriptionPatient(null);
          setPrescriptionImageUrl(null);
          setPrescriptionImageType(null);
          setSavedPrintHtml('');
          setSavedPrescriptionNumber('');
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              {isTreatmentSheet ? 'Review Extracted Medicines' : 'Transcribed Prescription'}
              {(prescriptionPatient || selectedPatient) && (
                <Badge variant="outline" className="ml-2">{prescriptionPatient?.name || selectedPatient?.name}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {isTreatmentSheet && hasJsonMedicines && prescriptionStep === 'review' ? (
            <div className="space-y-4">
              {/* Select All / Deselect All */}
              <div className="flex items-center justify-between border-b pb-3">
                <span className="text-sm text-gray-600">
                  {reviewMedicines.filter(m => m.checked).length} of {reviewMedicines.length} medicines selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReviewMedicines(prev => prev.map(m => ({ ...m, checked: !allChecked })))}
                >
                  {allChecked ? 'Deselect All' : 'Select All'}
                </Button>
              </div>

              {/* Medicine checklist table */}
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left w-8"></th>
                      <th className="px-3 py-2 text-left">Medicine</th>
                      <th className="px-3 py-2 text-left">Strength</th>
                      <th className="px-3 py-2 text-left">Route</th>
                      <th className="px-3 py-2 text-left">Frequency</th>
                      <th className="px-3 py-2 text-left">Duration</th>
                      <th className="px-3 py-2 text-left w-20">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewMedicines.map((med, idx) => (
                      <tr key={idx} className={`border-t ${med.checked ? 'bg-white' : 'bg-gray-50 opacity-60'}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={med.checked}
                            onChange={() => setReviewMedicines(prev => prev.map((m, i) => i === idx ? { ...m, checked: !m.checked } : m))}
                            className="h-4 w-4 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-bold text-sm">{med.generic_name || med.name.toUpperCase()}</div>
                          {med.brand_name && <div className="text-xs text-gray-500">({med.brand_name})</div>}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{med.strength || '-'}</td>
                        <td className="px-3 py-2 text-gray-600">{med.route || '-'}</td>
                        <td className="px-3 py-2 text-gray-600">{med.frequency || '-'}</td>
                        <td className="px-3 py-2 text-gray-600">{med.duration || '-'}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            value={med.qty}
                            onChange={(e) => setReviewMedicines(prev => prev.map((m, i) => i === idx ? { ...m, qty: Math.max(1, parseInt(e.target.value) || 1) } : m))}
                            className="w-16 h-7 border border-gray-300 rounded px-2 text-sm"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Doctor name input */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-gray-700">Prescribing Doctor</Label>
                <Input
                  placeholder="Enter doctor name..."
                  value={prescriptionDoctor}
                  onChange={(e) => setPrescriptionDoctor(e.target.value)}
                  className="max-w-sm"
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 justify-end pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPrescriptionModal(false);
                    setPrescriptionResult(null);
                    setPrescriptionStep('review');
                    setPrescriptionDoctor('');
                    setReviewMedicines([]);
                  }}
                >
                  Close
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  onClick={handleGeneratePrescription}
                  disabled={savingPrescription || reviewMedicines.filter(m => m.checked).length === 0}
                >
                  {savingPrescription ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>
                  ) : (
                    <>
                      <FileText className="h-4 w-4 mr-2" />
                      Generate Prescription
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : prescriptionStep === 'saved' ? (
            // Step 3: Saved confirmation with print button
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                <div className="text-green-600 text-4xl mb-3">&#10003;</div>
                <h3 className="text-lg font-bold text-green-800 mb-1">Prescription Saved Successfully!</h3>
                <p className="text-sm text-green-700">Rx No: <strong>{savedPrescriptionNumber}</strong></p>
                <p className="text-xs text-green-600 mt-1">Patient: {prescriptionPatient?.name || selectedPatient?.name || 'Unknown'} (ID: {(prescriptionPatient?.id || selectedPatient?.id || 'none').substring(0, 8)}...)</p>
                <p className="text-xs text-gray-500 mt-2">
                  This prescription is now visible in FinalBill → Saved Data → Prescriptions tab
                  and in the Pharmacy → Prescriptions queue.
                </p>
              </div>

              <div className="flex gap-2 justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPrescriptionModal(false);
                    setPrescriptionResult(null);
                    setPrescriptionStep('review');
                    setPrescriptionDoctor('');
                    setReviewMedicines([]);
                    setSavedPrintHtml('');
                    setSavedPrescriptionNumber('');
                  }}
                >
                  Close
                </Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    if (savedPrintHtml) {
                      const printWindow = window.open('', '_blank', 'width=800,height=900');
                      if (printWindow) {
                        printWindow.document.write(savedPrintHtml);
                        printWindow.document.close();
                      }
                    }
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Print Prescription
                </Button>
                <Button
                  variant="outline"
                  className="text-purple-600 border-purple-300 hover:bg-purple-50"
                  onClick={() => {
                    // Reset to review step for another prescription
                    setPrescriptionStep('review');
                    setSavedPrintHtml('');
                    setSavedPrescriptionNumber('');
                  }}
                >
                  New Prescription
                </Button>
              </div>
            </div>
          ) : (
            // Fallback: show raw transcribed text for non-treatment-sheet or no JSON
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
                {prescriptionResult?.replace(/===JSON===[\s\S]*===END_JSON===/, '').trim()}
              </div>
              <div className="flex gap-2 justify-end flex-wrap">
                <Button variant="outline" onClick={() => { setShowPrescriptionModal(false); setPrescriptionResult(null); }}>
                  Close
                </Button>
                <Button
                  onClick={() => {
                    if (prescriptionResult) {
                      navigator.clipboard.writeText(prescriptionResult);
                      toast({ title: 'Copied', description: 'Text copied to clipboard.' });
                    }
                  }}
                  variant="outline"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Copy
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => prescriptionResult && savePrescriptionToPatient(prescriptionResult)}
                  disabled={savingPrescription}
                >
                  {savingPrescription ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                  ) : (
                    'Save to Patient'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  };

  /** OPD Summary review & save modal */
  const renderOpdModal = () => {
    if (!opdExtracted) return null;

    return (
      <Dialog open={showOpdModal} onOpenChange={(open) => {
        if (!open) {
          setShowOpdModal(false);
          setOpdExtracted(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              OPD Summary - Extracted Data
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Patient Info */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
              <h4 className="text-sm font-semibold text-blue-800">Patient Information</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">Name:</span>{' '}
                  <span className="font-medium">{opdExtracted.patientName || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Age:</span>{' '}
                  <span className="font-medium">{opdExtracted.age || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Gender:</span>{' '}
                  <span className="font-medium">{opdExtracted.gender || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Phone:</span>{' '}
                  <span className="font-medium">{opdExtracted.phone || '-'}</span>
                </div>
              </div>
            </div>

            {/* Consultation Details */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
              <h4 className="text-sm font-semibold text-green-800">Consultation Details</h4>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-gray-500">Doctor:</span>{' '}
                  <span className="font-medium">{opdExtracted.doctorName || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Chief Complaint:</span>{' '}
                  <span className="font-medium">{opdExtracted.chiefComplaint || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Diagnosis:</span>{' '}
                  <span className="font-medium">{opdExtracted.diagnosis || '-'}</span>
                </div>
              </div>
            </div>

            {/* Vitals */}
            {(opdExtracted.vitals.bp || opdExtracted.vitals.pulse || opdExtracted.vitals.temperature || opdExtracted.vitals.weight || opdExtracted.vitals.spo2) && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-2">
                <h4 className="text-sm font-semibold text-orange-800">Vitals</h4>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  {opdExtracted.vitals.bp && (
                    <div><span className="text-gray-500">BP:</span> <span className="font-medium">{opdExtracted.vitals.bp}</span></div>
                  )}
                  {opdExtracted.vitals.pulse && (
                    <div><span className="text-gray-500">Pulse:</span> <span className="font-medium">{opdExtracted.vitals.pulse}</span></div>
                  )}
                  {opdExtracted.vitals.temperature && (
                    <div><span className="text-gray-500">Temp:</span> <span className="font-medium">{opdExtracted.vitals.temperature}</span></div>
                  )}
                  {opdExtracted.vitals.weight && (
                    <div><span className="text-gray-500">Weight:</span> <span className="font-medium">{opdExtracted.vitals.weight}</span></div>
                  )}
                  {opdExtracted.vitals.spo2 && (
                    <div><span className="text-gray-500">SpO2:</span> <span className="font-medium">{opdExtracted.vitals.spo2}</span></div>
                  )}
                </div>
              </div>
            )}

            {/* Medicines */}
            {opdExtracted.medicines.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-2">
                <h4 className="text-sm font-semibold text-purple-800">Medicines Prescribed</h4>
                <ul className="text-sm space-y-1">
                  {opdExtracted.medicines.map((med, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-purple-400 mt-0.5">&#8226;</span>
                      <span>{med}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Advice & Follow-up */}
            {(opdExtracted.advice || opdExtracted.followUp) && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1 text-sm">
                {opdExtracted.advice && (
                  <div><span className="text-gray-500">Advice:</span> <span className="font-medium">{opdExtracted.advice}</span></div>
                )}
                {opdExtracted.followUp && (
                  <div><span className="text-gray-500">Follow-up:</span> <span className="font-medium">{opdExtracted.followUp}</span></div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => { setShowOpdModal(false); setOpdExtracted(null); }}>
                Cancel
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={handleSaveOpdSummary}
                disabled={savingOpd}
              >
                {savingOpd ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving &amp; Opening Profile...</>
                ) : (
                  'Save & Open Patient Profile'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const content = (
    <div className="space-y-4">
      {renderCamera()}
      {renderDropZone()}
      {renderPreview()}
      {renderQuickSetup()}
      {transcribing && (
        <div className="flex items-center justify-center gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
          <span className="text-sm font-medium text-purple-700">
            {category === 'treatment_sheet' ? 'Extracting medicines from treatment sheet...'
              : category === 'opd_summary' ? 'Extracting OPD consultation data...'
              : 'Transcribing prescription with AI...'}
          </span>
        </div>
      )}
      {renderAiSmartInput()}
      {renderAiLoading()}
      {renderAiConfirm()}
      {renderMetadataForm()}
      {renderRecentUploads()}
    </div>
  );

  // -------------------------------------------------------------------------
  // Dialog vs standalone card rendering
  // -------------------------------------------------------------------------

  if (isDialog) {
    return (
      <>
        <Dialog open={open} onOpenChange={(val) => {
          if (!val) stopCamera();
          onOpenChange?.(val);
        }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-blue-600" />
                Camera Capture & Upload
              </DialogTitle>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
        {renderPrescriptionModal()}
        {renderOpdModal()}
      </>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Camera className="h-5 w-5 text-blue-600" />
            Camera Capture & Upload
          </CardTitle>
        </CardHeader>
        <CardContent>{content}</CardContent>
      </Card>
      {renderPrescriptionModal()}
      {renderOpdModal()}
    </>
  );
};

export default CameraUpload;

// ---------------------------------------------------------------------------
// QuickCaptureCard -- shows a card with camera and upload buttons
// ---------------------------------------------------------------------------

export const QuickCaptureCard: React.FC = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [todayCount, setTodayCount] = useState(0);

  useEffect(() => {
    const fetchTodayCount = async () => {
      try {
        const raw = localStorage.getItem('hmis_user');
        const user = raw ? JSON.parse(raw) : null;
        const userId = user?.id || user?.email || null;

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        let query = (supabase as any)
          .from('file_uploads')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayStart.toISOString());

        if (userId) {
          query = query.eq('uploaded_by', userId);
        }

        const { count, error } = await query;
        if (!error && typeof count === 'number') {
          setTodayCount(count);
        }
      } catch (e) {
        console.error('Error fetching today upload count:', e);
      }
    };

    fetchTodayCount();
  }, [dialogOpen]); // Re-fetch when dialog closes (new uploads may have been made)

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Camera className="h-5 w-5 text-blue-600" />
            Quick Capture
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 border-blue-200 hover:bg-blue-50 hover:border-blue-400"
              onClick={() => setDialogOpen(true)}
            >
              <Camera className="h-4 w-4 mr-2 text-blue-500" />
              Camera
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-blue-200 hover:bg-blue-50 hover:border-blue-400"
              onClick={() => setDialogOpen(true)}
            >
              <Upload className="h-4 w-4 mr-2 text-blue-500" />
              Upload
            </Button>
          </div>
          {todayCount > 0 && (
            <p className="text-xs text-gray-500 text-center">
              {todayCount} upload{todayCount !== 1 ? 's' : ''} today
            </p>
          )}
        </CardContent>
      </Card>

      <CameraUpload
        isDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
};

// ---------------------------------------------------------------------------
// FloatingCameraFAB -- fixed-position floating action button
// ---------------------------------------------------------------------------

export const FloatingCameraFAB: React.FC = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [todayCount, setTodayCount] = useState(0);

  useEffect(() => {
    const fetchTodayCount = async () => {
      try {
        const raw = localStorage.getItem('hmis_user');
        const user = raw ? JSON.parse(raw) : null;
        const userId = user?.id || user?.email || null;

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        let query = (supabase as any)
          .from('file_uploads')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayStart.toISOString());

        if (userId) {
          query = query.eq('uploaded_by', userId);
        }

        const { count, error } = await query;
        if (!error && typeof count === 'number') {
          setTodayCount(count);
        }
      } catch (e) {
        console.error('Error fetching today upload count:', e);
      }
    };

    fetchTodayCount();
  }, [dialogOpen]);

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className="fixed bottom-6 right-24 z-50 h-14 w-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
        aria-label="Open camera capture"
      >
        <Camera className="h-6 w-6" />
        {todayCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
            {todayCount > 99 ? '99+' : todayCount}
          </span>
        )}
      </button>

      <CameraUpload
        isDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
};
