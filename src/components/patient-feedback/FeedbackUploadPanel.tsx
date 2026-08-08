import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
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

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await uploadPatientFeedback({
        files: Array.from(files),
        patientId,
        patientName,
        caption,
        uploadedBy: user?.email ?? null,
      });
      toast.success(`${files.length} file(s) uploaded.`);
      setCaption("");
      queryClient.invalidateQueries({ queryKey: ["patient-feedback"] });
    } catch (error: any) {
      console.error("Failed to upload patient feedback:", error);
      toast.error(error?.message || "Could not upload. Please retry.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      <Button
        className="w-full"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        {uploading ? "Uploading…" : "Upload photo / video"}
      </Button>
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
        picked together.
      </p>
    </div>
  );
}
