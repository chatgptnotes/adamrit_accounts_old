import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, SwitchCamera, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { captureInAppPhoto } from "@/lib/captureInAppPhoto";

interface InvoiceCameraProps {
  open: boolean;
  onClose: () => void;
  /** Called with the single captured photo. */
  onCapture: (file: File) => void;
}

/**
 * A live in-app camera for the approved invoice. The form holds one document, so
 * a shot is handed back immediately. Mirrors the pattern in
 * src/tablet/modules/patient-profile/MultiShotCamera.tsx.
 */
export function InvoiceCamera({ open, onClose, onCapture }: InvoiceCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [busy, setBusy] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Camera capture is not supported in this browser. Use File instead.");
      onClose();
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1600 }, height: { ideal: 1200 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => videoRef.current?.play().catch(() => {});
      }
    } catch (e) {
      console.warn("[InvoiceCamera] camera error", e);
      toast.error("Unable to access the camera. Please check permissions.");
      onClose();
    }
  }, [facingMode, stopCamera, onClose]);

  useEffect(() => {
    if (open) void startCamera();
    else stopCamera();
  }, [open, startCamera, stopCamera]);
  useEffect(() => () => stopCamera(), [stopCamera]);

  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      toast.error("Camera is still loading — try again in a moment.");
      return;
    }

    setBusy(true);
    const result = await captureInAppPhoto(video, canvas);
    setBusy(false);
    if (!result) {
      toast.error("Could not capture the photo. Please try again.");
      return;
    }

    onCapture(
      new File([result.blob], `invoice_${Date.now()}.jpg`, { type: "image/jpeg" }),
    );
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Photograph the invoice</DialogTitle>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-h-[55vh] w-full object-contain"
          />
          <button
            type="button"
            aria-label="Switch camera"
            onClick={() => setFacingMode((p) => (p === "environment" ? "user" : "environment"))}
            className="absolute right-3 top-3 rounded-full bg-black/50 p-3 text-white hover:bg-black/70"
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        </div>
        <canvas ref={canvasRef} className="hidden" />

        <div className="flex gap-3">
          <TabletButton variant="outline" className="flex-1" onClick={onClose}>
            <X className="mr-2 h-5 w-5" /> Cancel
          </TabletButton>
          <TabletButton className="flex-1" disabled={busy} onClick={() => void capture()}>
            <Camera className="mr-2 h-5 w-5" /> Capture
          </TabletButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
