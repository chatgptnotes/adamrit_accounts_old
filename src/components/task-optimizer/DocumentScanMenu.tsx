// Generic document scan menu — camera or file upload → hands the captured/
// selected file to onFile(). Generalised from BillScanMenu (same in-app webcam),
// with all bill-specific logic removed so any feature can reuse it. The caller
// owns what happens to the file (OCR, extraction, etc.) and the busy state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Upload, Loader2, X, SwitchCamera, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  onFile: (file: Blob, fileName: string) => void;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
}

export default function DocumentScanMenu({ onFile, disabled, busy, title = 'Scan or upload a document' }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => videoRef.current?.play().catch(() => {});
      }
    } catch (e) {
      console.warn('[DocumentScanMenu] camera error', e);
      toast.error('Unable to access the camera. Please check permissions.');
      setCameraOpen(false);
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (cameraOpen) void startCamera();
    else stopCamera();
  }, [cameraOpen, startCamera, stopCamera]);
  useEffect(() => () => stopCamera(), [stopCamera]);

  const switchCamera = useCallback(() => setFacingMode((p) => (p === 'environment' ? 'user' : 'environment')), []);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      toast.error('Camera is still loading — try again in a moment.');
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast.error('Could not capture the photo. Please try again.');
          return;
        }
        setCameraOpen(false);
        onFile(blob, `scan_${Date.now()}.jpg`);
      },
      'image/jpeg',
      0.9,
    );
  }, [onFile]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        disabled={disabled || busy}
        title={title}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40 transition-colors"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
      </button>

      {menuOpen && !busy && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute bottom-9 left-0 z-50 w-44 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-xl">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setCameraOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              <Camera className="h-4 w-4 text-blue-600" /> Use camera
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              <Upload className="h-4 w-4 text-blue-600" /> Upload file
            </button>
          </div>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f, f.name);
          if (fileRef.current) fileRef.current.value = '';
        }}
      />
      <canvas ref={canvasRef} className="hidden" />

      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4 text-blue-600" /> Scan a document
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="max-h-[60vh] w-full object-contain" />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={capturePhoto}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                <Camera className="h-4 w-4" /> Capture &amp; scan
              </button>
              <button
                type="button"
                onClick={switchCamera}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
              >
                <SwitchCamera className="h-4 w-4" /> Switch
              </button>
              <button
                type="button"
                onClick={() => setCameraOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
