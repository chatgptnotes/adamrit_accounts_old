import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Upload, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPatientFeedback } from "@/hooks/usePatientFeedback";

interface FeedbackUploadPanelProps {
  patientId: string;
  patientName: string | null;
}

/**
 * Caption + photo/video picker for the selected patient. The caption is typed
 * first and applies to every file chosen in that one pick.
 */
export function FeedbackUploadPanel({ patientId, patientName }: FeedbackUploadPanelProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Three separate inputs rather than one. `capture` turns a file picker into
  // the camera, but it also forces a single file and it is the ACCEPT type that
  // decides whether the phone opens the stills camera or the camcorder -- so
  // photo, video and gallery cannot share one element without one of the three
  // behaving wrongly.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await uploadPatientFeedback({
        files: Array.from(files),
        patientId,
        patientName,
        caption,
        // file_uploads.uploaded_by is a uuid column — the email is rejected.
        uploadedBy: user?.id ?? null,
      });
      toast.success(`${files.length} file(s) uploaded.`);
      setCaption("");
      queryClient.invalidateQueries({ queryKey: ["patient-feedback"] });
    } catch (error: any) {
      console.error("Failed to upload patient feedback:", error);
      toast.error(error?.message || "Could not upload. Please retry.");
    } finally {
      setUploading(false);
      // Every input is cleared, not just the one used: without this, taking the
      // same shot twice in a row fires no change event the second time and the
      // capture is silently lost.
      for (const ref of [fileInputRef, photoInputRef, videoInputRef]) {
        if (ref.current) ref.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="Caption — what the patient said"
        rows={3}
        className="text-base"
      />
      {/* Camera first: on a phone this is the common case — the person is
          standing in front of the patient or the ward, not hunting a gallery. */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          className="h-14"
          onClick={() => photoInputRef.current?.click()}
          disabled={uploading}
        >
          <Camera className="mr-2 h-5 w-5" />
          Take photo
        </Button>
        <Button
          className="h-14"
          variant="secondary"
          onClick={() => videoInputRef.current?.click()}
          disabled={uploading}
        >
          <Video className="mr-2 h-5 w-5" />
          Record video
        </Button>
      </div>

      <Button
        className="w-full"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        {uploading ? "Uploading…" : "Choose from gallery"}
      </Button>

      {/* capture="environment" asks for the REAR camera, which is the one
          pointed at a patient or a ward. It is ignored on a desktop browser,
          where these fall back to an ordinary file picker. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <p className="text-[11px] text-muted-foreground">
        Photos and videos, up to 50 MB each. The caption applies to everything
        captured or picked together.
      </p>
    </div>
  );
}
