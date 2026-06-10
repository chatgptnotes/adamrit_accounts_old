// Skill Factory entry point for bill scanning. The "Scan a Bill" button opens a
// small menu offering Camera or Upload; either runs the same no-API OCR flow as
// the dashboard (extract → upload → create deadline → notification) right here,
// then the user can open the full dashboard to see the saved bill.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Upload, Loader2, X, SwitchCamera, ScanLine, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUtilityDeadlines, notifyBillScannedSlack } from '@/hooks/useUtilityDeadlines';
import { extractUtilityBill } from '@/lib/extractUtilityBill';
import { uploadBillAttachment } from '@/lib/uploadBillAttachment';

const inr = (n: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

interface Props {
  onOpenDashboard?: () => void;
}

export default function BillScanMenu({ onOpenDashboard }: Props) {
  const { createDeadline } = useUtilityDeadlines();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Scan → save → notify ──────────────────────────────────────────
  const scan = useCallback(
    async (file: Blob, fileName: string) => {
      setScanning(true);
      try {
        const ex = await extractUtilityBill(file, fileName);
        const url = await uploadBillAttachment(file, fileName);
        const notes = ex.consumer_number ? `Consumer No: ${ex.consumer_number}` : ex.biller || null;
        const inserted = await createDeadline({
          name: ex.name,
          bill_type: ex.bill_type,
          amount: ex.amount,
          due_date: ex.due_date,
          recurring: true,
          notes,
          attachment_url: url,
        });
        // Instant Slack alert for the scanned bill (dev-only relay; no-op in prod).
        if (inserted) void notifyBillScannedSlack(inserted);
        toast.success(`Scanned & added: ${ex.name} · ${inr(ex.amount)} · due ${ex.due_date}`, {
          action: onOpenDashboard ? { label: 'Open', onClick: onOpenDashboard } : undefined,
        });
      } catch (e: unknown) {
        console.warn('[BillScanMenu] scan failed', e);
        const msg = e instanceof Error ? e.message : 'Could not scan the bill.';
        toast.error(`${msg} Open the dashboard to add it manually.`);
      } finally {
        setScanning(false);
      }
    },
    [createDeadline, onOpenDashboard],
  );

  // ── Camera (mirrors the dashboard's in-app webcam) ────────────────
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
      console.warn('[BillScanMenu] camera error', e);
      toast.error('Unable to access the camera. Please check permissions.');
      setCameraOpen(false);
    }
  }, [facingMode, stopCamera]);

  // Start/stop the stream as the camera dialog opens/closes, and flip on switch.
  useEffect(() => {
    if (cameraOpen) void startCamera();
    else stopCamera();
  }, [cameraOpen, startCamera, stopCamera]);

  // Stop the camera on unmount so the device light doesn't linger.
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
        void scan(blob, `bill_capture_${Date.now()}.jpg`);
      },
      'image/jpeg',
      0.9,
    );
  }, [scan]);

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((o) => !o)}
        disabled={scanning}
        title="Scan a bill — camera or upload"
        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-lg ring-2 ring-blue-300/60 disabled:opacity-60"
      >
        {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
        {scanning ? 'Scanning…' : 'Scan a Bill'}
      </button>

      {menuOpen && !scanning && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 mt-1.5 z-50 w-48 rounded-lg border border-slate-200 bg-white shadow-xl py-1 text-left">
            <button
              onClick={() => {
                setMenuOpen(false);
                setCameraOpen(true);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              <Camera className="w-4 h-4 text-blue-600" /> Use camera
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
            >
              <Upload className="w-4 h-4 text-blue-600" /> Upload bill
            </button>
            {onOpenDashboard && (
              <>
                <div className="my-1 border-t border-slate-100" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenDashboard();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open dashboard
                </button>
              </>
            )}
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
          if (f) void scan(f, f.name);
          if (fileRef.current) fileRef.current.value = '';
        }}
      />
      <canvas ref={canvasRef} className="hidden" />

      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Camera className="w-4 h-4 text-blue-600" /> Scan a bill
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-[60vh] object-contain" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={capturePhoto}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                <Camera className="w-4 h-4" /> Capture &amp; scan
              </button>
              <button
                onClick={switchCamera}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              >
                <SwitchCamera className="w-4 h-4" /> Switch
              </button>
              <button
                onClick={() => setCameraOpen(false)}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
