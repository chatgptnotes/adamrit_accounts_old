import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, ScanLine, Camera, Upload, X, Circle } from 'lucide-react';
import { VisitRegistrationForm } from '@/components/VisitRegistrationForm';
import { extractTextFromImage, parsePatientData, ExtractedPatientData } from '@/lib/documentOcr';

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

const AddEmergencyPatientDialog: React.FC<AddEmergencyPatientDialogProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scannedData, setScannedData] = useState<ExtractedPatientData | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const { toast } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stop camera on unmount
  useEffect(() => {
    return () => { stopCamera(); };
  }, []);

  // Stop camera when dialog closes
  useEffect(() => {
    if (!open) stopCamera();
  }, [open]);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
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

  const startCamera = async () => {
    // Try back camera first (mobile), fall back to any camera (desktop)
    const constraints = [
      { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: true },
    ];
    for (const c of constraints) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(c);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setCameraActive(true);
        }
        return;
      } catch {
        // try next constraint
      }
    }
    toast({ title: 'Camera error', description: 'Could not access camera. Please use Upload File instead.', variant: 'destructive' });
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      stopCamera();
      const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      await runOcr(file);
    }, 'image/jpeg', 0.9);
  };

  const runOcr = async (file: File) => {
    setScanning(true);
    setScanProgress(0);
    setScannedData(null);
    try {
      const text = await extractTextFromImage(file, setScanProgress);
      const parsed = parsePatientData(text);
      setScannedData(parsed);
      if (parsed.name) {
        setSearch(parsed.name);
        toast({ title: 'Document scanned', description: `Name found: ${parsed.name}` });
      } else {
        toast({ title: 'Scan complete', description: 'Name not detected. Please type manually.', variant: 'destructive' });
      }
    } catch (err: any) {
      toast({ title: 'Scan failed', description: err.message, variant: 'destructive' });
    } finally {
      setScanning(false);
      setScanProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await runOcr(file);
  };

  const handleClose = () => {
    stopCamera();
    setSearch('');
    setResults([]);
    setSelectedPatient(null);
    setScannedData(null);
    onOpenChange(false);
  };

  if (selectedPatient) {
    return (
      <VisitRegistrationForm
        isOpen={true}
        onClose={handleClose}
        patient={selectedPatient}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Emergency Patient</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">

          {/* Camera view */}
          {cameraActive && (
            <div className="relative rounded-md overflow-hidden bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full rounded-md" />
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-3">
                <Button size="sm" variant="destructive" onClick={stopCamera} className="gap-1">
                  <X className="h-4 w-4" /> Cancel
                </Button>
                <Button size="sm" onClick={capturePhoto} className="gap-1 bg-white text-black hover:bg-gray-100">
                  <Circle className="h-4 w-4 fill-current" /> Capture
                </Button>
              </div>
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />

          {/* Scanning progress */}
          {scanning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning document... {scanProgress}%
            </div>
          )}

          {/* Action buttons — hidden while camera active or scanning */}
          {!cameraActive && !scanning && (
            <div className="flex gap-2">
              <Button className="flex-1 gap-2" onClick={startCamera}>
                <Camera className="h-4 w-4" />
                Open Camera
              </Button>
              <Button variant="outline" className="flex-1 gap-2" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                Upload File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* Scanned Data Preview */}
          {scannedData && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Extracted from document</p>
              {scannedData.name    && <p><span className="text-muted-foreground w-16 inline-block">Name</span> {scannedData.name}</p>}
              {scannedData.age     && <p><span className="text-muted-foreground w-16 inline-block">Age</span> {scannedData.age} yrs</p>}
              {scannedData.dob     && <p><span className="text-muted-foreground w-16 inline-block">DOB</span> {scannedData.dob}</p>}
              {scannedData.gender  && <p><span className="text-muted-foreground w-16 inline-block">Gender</span> {scannedData.gender}</p>}
              {scannedData.phone   && <p><span className="text-muted-foreground w-16 inline-block">Phone</span> {scannedData.phone}</p>}
              {scannedData.address && <p><span className="text-muted-foreground w-16 inline-block">Address</span> {scannedData.address}</p>}
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Type or scan patient name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {results.length > 0 && (
            <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
              {results.map((patient) => (
                <button
                  key={patient.id}
                  className="w-full text-left px-4 py-3 hover:bg-muted transition-colors"
                  onClick={() => setSelectedPatient(patient)}
                >
                  <p className="font-medium">{patient.name}</p>
                  <p className="text-sm text-muted-foreground">ID: {patient.patients_id}</p>
                </button>
              ))}
            </div>
          )}

          {!searching && search.trim() && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No patients found for "{search}"
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddEmergencyPatientDialog;
