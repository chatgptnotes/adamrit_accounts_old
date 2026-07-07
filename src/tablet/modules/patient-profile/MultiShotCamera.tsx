import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, SwitchCamera, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { captureInAppPhoto } from "@/lib/captureInAppPhoto";
import type { GeoCapture } from "@/lib/geotag";

interface Shot {
  id: string;
  url: string;
  blob: Blob;
  geo: GeoCapture | null;
}

export interface CapturedPhotoItem {
  file: File;
  geo: GeoCapture | null;
}

interface MultiShotCameraProps {
  open: boolean;
  onClose: () => void;
  /** Called with every captured photo when the user taps Done. */
  onCapture: (photos: CapturedPhotoItem[]) => void;
}

/**
 * A live in-app camera that stays open so the user can snap multiple photos in a
 * row (no back-and-forth to the OS camera app). Captured shots collect in a tray
 * and are handed back together on Done. Uses getUserMedia, mirroring the pattern
 * in src/components/task-optimizer/DocumentScanMenu.tsx.
 */
export function MultiShotCamera({
  open,
  onClose,
  onCapture,
}: MultiShotCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">(
    "environment",
  );
  const [shots, setShots] = useState<Shot[]>([]);

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
        videoRef.current.onloadedmetadata = () =>
          videoRef.current?.play().catch(() => {});
      }
    } catch (e) {
      console.warn("[MultiShotCamera] camera error", e);
      toast.error("Unable to access the camera. Please check permissions.");
      onClose();
    }
  }, [facingMode, stopCamera, onClose]);

  useEffect(() => {
    if (open) void startCamera();
    else stopCamera();
  }, [open, startCamera, stopCamera]);
  useEffect(() => () => stopCamera(), [stopCamera]);

  // Release preview object URLs when the tray is cleared / unmounted.
  useEffect(
    () => () => shots.forEach((s) => URL.revokeObjectURL(s.url)),
    [shots],
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      toast.error("Camera is still loading — try again in a moment.");
      return;
    }

    const result = await captureInAppPhoto(video, canvas);
    if (!result) {
      toast.error("Could not capture the photo. Please try again.");
      return;
    }

    setShots((prev) => [
      ...prev,
      {
        id: `${prev.length}_${result.blob.size}`,
        url: URL.createObjectURL(result.blob),
        blob: result.blob,
        geo: result.geo,
      },
    ]);
  }, []);

  const removeShot = (id: string) => {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
  };

  const finish = () => {
    if (shots.length === 0) {
      onClose();
      return;
    }
    const photos: CapturedPhotoItem[] = shots.map((s, i) => ({
      file: new File([s.blob], `camera_${Date.now()}_${i + 1}.jpg`, {
        type: "image/jpeg",
      }),
      geo: s.geo,
    }));
    onCapture(photos);
    setShots([]);
    onClose();
  };

  const cancel = () => {
    setShots([]);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Take Photos</DialogTitle>
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
            onClick={() =>
              setFacingMode((p) => (p === "environment" ? "user" : "environment"))
            }
            className="absolute right-3 top-3 rounded-full bg-black/50 p-3 text-white hover:bg-black/70"
          >
            <SwitchCamera className="h-5 w-5" />
          </button>
        </div>
        <canvas ref={canvasRef} className="hidden" />

        {/* Captured tray */}
        {shots.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {shots.map((s) => (
              <div key={s.id} className="relative shrink-0">
                <img
                  src={s.url}
                  alt="captured"
                  className="h-16 w-16 rounded-lg object-cover"
                />
                {s.geo ? (
                  <span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-emerald-600/80 px-0.5 text-center text-[8px] text-white">
                    GPS
                  </span>
                ) : (
                  <span className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-amber-600/80 px-0.5 text-center text-[8px] text-white">
                    No GPS
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => removeShot(s.id)}
                  className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <TabletButton variant="outline" className="flex-1" onClick={cancel}>
            <Trash2 className="h-5 w-5" /> Cancel
          </TabletButton>
          <TabletButton className="flex-1" onClick={() => void capture()}>
            <Camera className="h-5 w-5" /> Capture
          </TabletButton>
          <TabletButton
            variant="default"
            className="flex-1"
            disabled={shots.length === 0}
            onClick={finish}
          >
            Done ({shots.length})
          </TabletButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
