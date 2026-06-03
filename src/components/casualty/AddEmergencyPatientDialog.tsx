import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Search, Camera, Upload, X, Circle, UserPlus, CheckCircle2, Eye, RefreshCw } from 'lucide-react';
import { VisitRegistrationForm } from '@/components/VisitRegistrationForm';
import { extractTextFromImage, parsePatientData, ExtractedPatientData } from '@/lib/documentOcr';
import { generatePatientId } from '@/utils/patientIdGenerator';

interface Patient {
  id: string;
  name: string;
  patients_id: string;
}

interface AddEmergencyPatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function mergeScanned(front: ExtractedPatientData | null, back: ExtractedPatientData | null): ExtractedPatientData {
  return {
    name:    front?.name    || back?.name,
    dob:     front?.dob     || back?.dob,
    age:     front?.age     || back?.age,
    gender:  front?.gender  || back?.gender,
    phone:   front?.phone   || back?.phone,
    address: back?.address  || front?.address,
  };
}

const AddEmergencyPatientDialog: React.FC<AddEmergencyPatientDialogProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const [search, setSearch]           = useState('');
  const [results, setResults]         = useState<Patient[]>([]);
  const [searching, setSearching]     = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const [frontData, setFrontData]     = useState<ExtractedPatientData | null>(null);
  const [backData, setBackData]       = useState<ExtractedPatientData | null>(null);
  const [frontFile, setFrontFile]     = useState<File | null>(null);
  const [backFile, setBackFile]       = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview]   = useState<string | null>(null);
  const [scanningSlot, setScanningSlot] = useState<'front' | 'back' | null>(null);
  const [scanProgress, setScanProgress] = useState(0);

  const [cameraActive, setCameraActive]     = useState(false);
  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const [registering, setRegistering]       = useState(false);
  const [quickForm, setQuickForm]           = useState({ name: '', age: '', dob: '', gender: '', phone: '' });
  const [previewImage, setPreviewImage]     = useState<string | null>(null);
  // Sequential scan: null → front → back → done
  const [scanStep, setScanStep]             = useState<null | 'front' | 'back' | 'done'>(null);

  const { toast }          = useToast();
  const { hospitalConfig } = useAuth();
  const debounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desktopFileRef     = useRef<HTMLInputElement>(null);
  const mobileFileRef      = useRef<HTMLInputElement>(null);
  const uploadFileRef      = useRef<HTMLInputElement>(null);
  const isUploadFlow       = useRef(false);
  const videoRef           = useRef<HTMLVideoElement>(null);
  const canvasRef          = useRef<HTMLCanvasElement>(null);
  const streamRef          = useRef<MediaStream | null>(null);
  const slotRef            = useRef<'front' | 'back'>('front');

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => { return () => stopCamera(); }, []);
  useEffect(() => { if (!open) { stopCamera(); resetAll(); } }, [open]);

  // Auto-search when front/back data changes
  useEffect(() => {
    const merged = mergeScanned(frontData, backData);
    if (!merged.name) return;
    setSearch(merged.name);
  }, [frontData, backData]);

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase
          .from('patients')
          .select('id, name, patients_id')
          .ilike('name', `%${search.trim()}%`)
          .limit(10);
        if (error) throw error;
        setResults((data as Patient[]) || []);
      } catch (err: any) {
        toast({ title: 'Search failed', description: err.message, variant: 'destructive' });
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [search]);

  const startScan = () => {
    setFrontData(null); setBackData(null);
    setFrontFile(null); setBackFile(null);
    if (frontPreview) URL.revokeObjectURL(frontPreview);
    if (backPreview)  URL.revokeObjectURL(backPreview);
    setFrontPreview(null); setBackPreview(null);
    slotRef.current = 'front';
    setScanStep('front');
    isUploadFlow.current = false;
    if (isMobile) mobileFileRef.current?.click();
    else startDesktopCamera();
  };

  const startUpload = () => {
    setFrontData(null); setBackData(null);
    setFrontFile(null); setBackFile(null);
    if (frontPreview) URL.revokeObjectURL(frontPreview);
    if (backPreview)  URL.revokeObjectURL(backPreview);
    setFrontPreview(null); setBackPreview(null);
    slotRef.current = 'front';
    setScanStep('front');
    isUploadFlow.current = true;
    uploadFileRef.current?.click();
  };

  const startDesktopCamera = async () => {
    const constraints = [
      { video: { facingMode: 'environment' } },
      { video: { facingMode: 'user' } },
      { video: true },
    ];
    for (const c of constraints) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(c);
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          const activate = () => { video.play().catch(() => {}); setCameraActive(true); };
          video.addEventListener('loadedmetadata', activate, { once: true });
          video.addEventListener('loadeddata',     activate, { once: true });
          setTimeout(() => setCameraActive(true), 1500);
        }
        return;
      } catch { /* try next */ }
    }
    toast({ title: 'Camera error', description: 'Could not access camera. Use Upload instead.', variant: 'destructive' });
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const captureDesktop = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      stopCamera();
      const file = new File([blob], `aadhaar_${slotRef.current}.jpg`, { type: 'image/jpeg' });
      await runOcr(file, slotRef.current);
    }, 'image/jpeg', 0.9);
  };

  const runOcr = async (file: File, slot: 'front' | 'back') => {
    setScanningSlot(slot);
    setScanProgress(0);

    const previewUrl = URL.createObjectURL(file);
    if (slot === 'front') { setFrontFile(file); setFrontPreview(previewUrl); }
    else                  { setBackFile(file);  setBackPreview(previewUrl); }

    try {
      const { text, confidence } = await extractTextFromImage(file, setScanProgress, slot === 'back');
      const parsed = parsePatientData(text);

      // Quality checks — detect blurry / unreadable photo
      const trimmed = text.trim();
      const isBlurry = confidence < 40 || trimmed.length < 30;
      const noUsefulData = !parsed.name && !parsed.dob && !parsed.phone;

      if (isBlurry || noUsefulData) {
        // Clean up — don't keep bad preview
        if (slot === 'front') {
          setFrontFile(null);
          if (frontPreview) URL.revokeObjectURL(frontPreview);
          setFrontPreview(null);
        } else {
          setBackFile(null);
          if (backPreview) URL.revokeObjectURL(backPreview);
          setBackPreview(null);
        }
        setScanStep(null);
        slotRef.current = 'front';
        stopCamera();
        toast({
          title: isBlurry ? 'Photo blurry or unclear' : 'Could not read Aadhaar',
          description: slot === 'front'
            ? 'Front side mein naam/details nahi padh paye. Saaf photo dobara lo (achhi light, no blur).'
            : 'Back side ka data nahi mila. Saaf photo dobara lo.',
          variant: 'destructive',
        });
        return;
      }

      if (slot === 'front') setFrontData(parsed);
      else                  setBackData(parsed);

      const merged = mergeScanned(
        slot === 'front' ? parsed : frontData,
        slot === 'back'  ? parsed : backData,
      );
      setQuickForm({
        name:   merged.name   || '',
        age:    merged.age    || '',
        dob:    merged.dob    || '',
        gender: merged.gender || '',
        phone:  merged.phone  || '',
      });

      // Front-specific check — name MUST be readable from front
      if (slot === 'front' && !parsed.name) {
        toast({
          title: 'Naam nahi padh paya',
          description: 'Front Aadhaar pe naam clearly nahi dikha. Photo saaf hai? Dobara try karo ya manually likho.',
          variant: 'destructive',
        });
      }

      if (slot === 'front') {
        setScanStep('back');
        slotRef.current = 'back';
        if (isUploadFlow.current) {
          if (uploadFileRef.current) uploadFileRef.current.value = '';
          setTimeout(() => uploadFileRef.current?.click(), 400);
        } else if (isMobile) {
          if (mobileFileRef.current) mobileFileRef.current.value = '';
          setTimeout(() => mobileFileRef.current?.click(), 400);
        }
        // Desktop camera: stays open, user clicks Capture again
      } else {
        setScanStep('done');
        stopCamera();
        toast({ title: 'Aadhaar scanned', description: merged.name ? `Name: ${merged.name}` : 'Scan complete' });
      }
    } catch (err: any) {
      setScanStep('done');
      stopCamera();
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    } finally {
      setScanningSlot(null);
      setScanProgress(0);
      if (desktopFileRef.current) desktopFileRef.current.value = '';
      if (slot === 'back' && mobileFileRef.current) mobileFileRef.current.value = '';
    }
  };

  // Upload both aadhaar images to Supabase storage under the patient record
  const uploadAadhaarImages = async (patientId: string) => {
    const uploads = [
      { file: frontFile, side: 'front' },
      { file: backFile,  side: 'back'  },
    ].filter((u) => u.file);

    for (const { file, side } of uploads) {
      const ts       = Date.now();
      const filePath = `aadhaar/${patientId}/${side}_${ts}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('patient-documents')
        .upload(filePath, file!, { contentType: 'image/jpeg', upsert: true });
      if (upErr) { console.error('Aadhaar upload error:', upErr); continue; }

      const { data: urlData } = supabase.storage
        .from('patient-documents')
        .getPublicUrl(filePath);

      await supabase.from('patient_documents').insert({
        patient_id:        patientId,
        document_type_id:  3,               // Identity Document (Aadhar/PAN/DL)
        document_name:     `Aadhaar Card - ${side === 'front' ? 'Front' : 'Back'}`,
        file_name:         `aadhaar_${side}_${ts}.jpg`,
        file_path:         filePath,
        file_url:          urlData.publicUrl,
        file_type:         'image/jpeg',
        storage_bucket:    'patient-documents',
        is_uploaded:       true,
        uploaded_at:       new Date().toISOString(),
      });
    }
  };

  const handleQuickRegister = async () => {
    if (!quickForm.name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    setRegistering(true);
    try {
      const patientId = await generatePatientId(hospitalConfig?.id as any);
      const { data, error } = await supabase
        .from('patients')
        .insert({
          name:          quickForm.name.trim(),
          patients_id:   patientId,
          age:           quickForm.age ? parseInt(quickForm.age) : null,
          date_of_birth: quickForm.dob    || null,
          gender:        quickForm.gender || null,
          phone:         quickForm.phone  || null,
        })
        .select('id, name, patients_id')
        .single();
      if (error) throw error;

      await uploadAadhaarImages(patientId);

      toast({ title: 'Patient registered!', description: `ID: ${patientId}` });
      setSelectedPatient(data as Patient);
    } catch (err: any) {
      toast({ title: 'Registration failed', description: err.message, variant: 'destructive' });
    } finally {
      setRegistering(false);
    }
  };

  // Also upload when selecting existing patient
  const handleSelectExisting = async (patient: Patient) => {
    if (frontFile || backFile) {
      await uploadAadhaarImages(patient.patients_id);
    }
    setSelectedPatient(patient);
  };

  const resetAll = () => {
    setSearch(''); setResults([]); setSelectedPatient(null);
    setFrontData(null); setBackData(null);
    setFrontFile(null); setBackFile(null);
    if (frontPreview) URL.revokeObjectURL(frontPreview);
    if (backPreview)  URL.revokeObjectURL(backPreview);
    setFrontPreview(null); setBackPreview(null);
    setShowQuickRegister(false); setScanningSlot(null);
    setPreviewImage(null); setScanStep(null);
  };

  const handleClose = () => { stopCamera(); resetAll(); onOpenChange(false); };

  if (selectedPatient) {
    return <VisitRegistrationForm isOpen={true} onClose={handleClose} patient={selectedPatient} defaultPatientType="Emergency" />;
  }

  const merged    = mergeScanned(frontData, backData);
  const hasData   = frontData || backData;
  const noResults = !searching && search.trim() && results.length === 0;
  const isScanning = scanningSlot !== null;

  // Label shown inside the desktop camera view
  const cameraPrompt = scanStep === 'back' && !isScanning
    ? 'Now capture Back side'
    : 'Capture Front side';

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Emergency Patient</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">

            {/* Desktop live camera */}
            {cameraActive && (
              <div className="relative rounded-md overflow-hidden bg-black">
                <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-md" />
                <p className="absolute top-2 left-0 right-0 text-center text-white text-xs font-medium drop-shadow">
                  {isScanning ? <><Loader2 className="inline h-3 w-3 animate-spin mr-1" />{scanProgress}%</> : cameraPrompt}
                </p>
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-3">
                  <Button size="sm" variant="destructive" onClick={() => { stopCamera(); setScanStep(null); }} className="gap-1">
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                  <Button size="sm" onClick={captureDesktop} disabled={isScanning}
                    className="gap-1 bg-white text-black hover:bg-gray-100">
                    <Circle className="h-4 w-4 fill-current" /> Capture
                  </Button>
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />

            {/* Hidden file inputs */}
            <input ref={desktopFileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) runOcr(f, slotRef.current); }} />
            <input ref={mobileFileRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) runOcr(f, slotRef.current); }} />
            <input ref={uploadFileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) runOcr(f, slotRef.current); }} />

            {/* Single Scan Aadhaar button + step indicator */}
            {!cameraActive && (
              <div className="space-y-2">
                {/* Step status pills */}
                {scanStep && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${frontData ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {frontData ? <CheckCircle2 className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                      Front
                    </span>
                    <span className="text-muted-foreground">→</span>
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${backData ? 'bg-green-100 text-green-700' : scanStep === 'back' ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'}`}>
                      {backData ? <CheckCircle2 className="h-3 w-3" /> : scanStep === 'back' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Circle className="h-3 w-3" />}
                      Back
                    </span>
                    {isScanning && <span className="ml-auto text-muted-foreground">{scanProgress}%</span>}
                  </div>
                )}

                {/* Thumbnails row */}
                {(frontPreview || backPreview) && (
                  <div className="flex gap-2">
                    {frontPreview && (
                      <div className="relative flex-1 cursor-pointer" onClick={() => setPreviewImage(frontPreview)}>
                        <img src={frontPreview} alt="Front" className="w-full h-20 object-cover rounded border" />
                        <span className="absolute bottom-1 left-1 text-[10px] bg-black/50 text-white px-1 rounded">Front</span>
                        <Eye className="absolute top-1 right-1 h-3 w-3 text-white drop-shadow" />
                      </div>
                    )}
                    {backPreview && (
                      <div className="relative flex-1 cursor-pointer" onClick={() => setPreviewImage(backPreview)}>
                        <img src={backPreview} alt="Back" className="w-full h-20 object-cover rounded border" />
                        <span className="absolute bottom-1 left-1 text-[10px] bg-black/50 text-white px-1 rounded">Back</span>
                        <Eye className="absolute top-1 right-1 h-3 w-3 text-white drop-shadow" />
                      </div>
                    )}
                  </div>
                )}

                <Button
                  variant={scanStep === 'done' ? 'outline' : 'default'}
                  className="w-full gap-2"
                  onClick={startScan}
                  disabled={isScanning}>
                  {isScanning
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Scanning…</>
                    : scanStep === 'done'
                      ? <><RefreshCw className="h-4 w-4" /> Rescan Aadhaar</>
                      : <><Camera className="h-4 w-4" /> Scan Aadhaar</>}
                </Button>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={startUpload}
                  disabled={isScanning}>
                  <Upload className="h-4 w-4" /> Upload from Gallery
                </Button>
              </div>
            )}

            {/* Merged extracted data */}
            {hasData && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Extracted Data</p>
                {merged.name    && <p><span className="text-muted-foreground w-16 inline-block">Name</span> {merged.name}</p>}
                {merged.age     && <p><span className="text-muted-foreground w-16 inline-block">Age</span> {merged.age} yrs</p>}
                {merged.dob     && <p><span className="text-muted-foreground w-16 inline-block">DOB</span> {merged.dob}</p>}
                {merged.gender  && <p><span className="text-muted-foreground w-16 inline-block">Gender</span> {merged.gender}</p>}
                {merged.phone   && <p><span className="text-muted-foreground w-16 inline-block">Phone</span> {merged.phone}</p>}
                {merged.address && <p><span className="text-muted-foreground w-16 inline-block">Address</span> {merged.address}</p>}
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Type or scan patient name..." value={search}
                onChange={(e) => { setSearch(e.target.value); setShowQuickRegister(false); }}
                className="pl-9" />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {/* Results */}
            {results.length > 0 && (
              <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                {results.map((patient) => (
                  <button key={patient.id} className="w-full text-left px-4 py-3 hover:bg-muted transition-colors"
                    onClick={() => handleSelectExisting(patient)}>
                    <p className="font-medium">{patient.name}</p>
                    <p className="text-sm text-muted-foreground">ID: {patient.patients_id}</p>
                  </button>
                ))}
              </div>
            )}

            {/* No results */}
            {noResults && !showQuickRegister && (
              <div className="text-center space-y-3 py-2">
                <p className="text-sm text-muted-foreground">No patients found for "{search}"</p>
                <Button className="gap-2 w-full"
                  onClick={() => { setQuickForm((f) => ({ ...f, name: f.name || search })); setShowQuickRegister(true); }}>
                  <UserPlus className="h-4 w-4" /> Register New Patient
                </Button>
              </div>
            )}

            {/* Quick register form */}
            {showQuickRegister && (
              <div className="border rounded-md p-4 space-y-3 bg-muted/20">
                <p className="font-semibold text-sm">New Patient Registration</p>
                <div className="space-y-2">
                  <Input placeholder="Full Name *" value={quickForm.name}
                    onChange={(e) => setQuickForm((f) => ({ ...f, name: e.target.value }))} />
                  <div className="flex gap-2">
                    <Input placeholder="Age" value={quickForm.age} className="w-24"
                      onChange={(e) => setQuickForm((f) => ({ ...f, age: e.target.value }))} />
                    <select value={quickForm.gender}
                      onChange={(e) => setQuickForm((f) => ({ ...f, gender: e.target.value }))}
                      className="flex-1 border rounded-md px-3 py-2 text-sm bg-background">
                      <option value="">Gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <Input placeholder="Phone" value={quickForm.phone}
                    onChange={(e) => setQuickForm((f) => ({ ...f, phone: e.target.value }))} />
                  <Input placeholder="DOB (YYYY-MM-DD)" value={quickForm.dob}
                    onChange={(e) => setQuickForm((f) => ({ ...f, dob: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setShowQuickRegister(false)}>Cancel</Button>
                  <Button className="flex-1 gap-2" onClick={handleQuickRegister} disabled={registering}>
                    {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Register & Continue
                  </Button>
                </div>
              </div>
            )}

          </div>
        </DialogContent>
      </Dialog>

      {/* Full-screen Aadhaar preview */}
      {previewImage && (
        <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Aadhaar Card Preview</DialogTitle>
            </DialogHeader>
            <img src={previewImage} alt="Aadhaar" className="w-full rounded-md" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default AddEmergencyPatientDialog;
