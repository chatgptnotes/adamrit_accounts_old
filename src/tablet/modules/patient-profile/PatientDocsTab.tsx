import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Download,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { shortDate } from "@/tablet/lib/format";
import { compressImageToLimit } from "@/tablet/lib/image";
import { MultiShotCamera, type CapturedPhotoItem } from "@/tablet/modules/patient-profile/MultiShotCamera";
import { googleMapsUrl } from "@/lib/geotag";

/** Max size per file after (image) compression. */
const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
import {
  deletePatientDoc,
  uploadPatientDocs,
  usePatientDocs,
  type PatientDoc,
  type PatientDocCategory,
} from "@/tablet/hooks/usePatientDocs";

interface PatientDocsTabProps {
  patientId: string;
  patientName: string | null;
  category: PatientDocCategory;
  label: string;
  /**
   * Written to `file_uploads.notes`. Registration documents MUST carry the
   * document-name JSON from buildRegistrationDocumentNotes — the panel document
   * checklist and the pending-document bell identify a document by that value,
   * so an upload without it stays Pending forever.
   */
  uploadNotes?: string | null;
  /** Blocks upload until the caller supplies uploadNotes (e.g. picks a name). */
  uploadDisabledReason?: string | null;
}

function isImage(type: string | null): boolean {
  return !!type && type.startsWith("image/");
}

function isPdf(type: string | null): boolean {
  return !!type && type.includes("pdf");
}

/** Blob download — same pattern as DocumentUploadDialog.handleDownloadClick. */
async function downloadDoc(doc: PatientDoc) {
  const response = await fetch(doc.fileUrl);
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = doc.fileName || "document";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * A per-patient photo/document folder for one category: upload (camera or
 * choose one/many files), view full-size, download and delete.
 */
export function PatientDocsTab({
  patientId,
  patientName,
  category,
  label,
  uploadNotes = null,
  uploadDisabledReason = null,
}: PatientDocsTabProps) {
  const { user, hospitalConfig } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const docs = usePatientDocs(patientId, category);

  const chooseRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [viewing, setViewing] = useState<PatientDoc | null>(null);

  const handleFiles = async (items: File[] | CapturedPhotoItem[]) => {
    if (items.length === 0) return;
    if (uploadDisabledReason) {
      toast({
        title: "Cannot upload yet",
        description: uploadDisabledReason,
        variant: "destructive",
      });
      return;
    }
    setUploading(true);
    try {
      const normalized: CapturedPhotoItem[] = items.map((item) =>
        item instanceof File ? { file: item, geo: null } : item,
      );
      // Keep each file under 1.5 MB: shrink images, reject oversized PDFs.
      const prepared: CapturedPhotoItem[] = [];
      const rejected: string[] = [];
      for (const { file, geo } of normalized) {
        const out = await compressImageToLimit(file, MAX_FILE_BYTES);
        if (out.size > MAX_FILE_BYTES) {
          rejected.push(out.name);
        } else {
          prepared.push({ file: out, geo });
        }
      }
      if (rejected.length > 0) {
        toast({
          title: "Some files too large",
          description: `${rejected.length} file(s) exceed 1.5 MB and were skipped: ${rejected.join(", ")}`,
          variant: "destructive",
        });
      }
      if (prepared.length === 0) {
        setUploading(false);
        return;
      }
      await uploadPatientDocs(
        prepared.map((p) => ({
          file: p.file,
          geo: p.geo,
          captureSource: p.geo ? "in_app_camera" : "file_picker",
        })),
        {
          patientId,
          patientName,
          category,
          uploadedBy: user?.id ?? null,
          placeLabel: `${hospitalConfig.fullName}, ${hospitalConfig.contactInfo.address}, India`,
          notes: uploadNotes,
        },
      );
      await qc.invalidateQueries({
        queryKey: ["tablet-patient-docs", patientId, category],
      });
      toast({
        title: "Uploaded",
        description: `${prepared.length} file(s) added to ${label}.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: PatientDoc) => {
    try {
      await deletePatientDoc(doc);
      await qc.invalidateQueries({
        queryKey: ["tablet-patient-docs", patientId, category],
      });
      if (viewing?.id === doc.id) setViewing(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not delete.";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    }
  };

  const items = docs.data || [];

  return (
    <div className="space-y-4">
      {/* Upload controls */}
      <div className="flex gap-3">
        <input
          ref={chooseRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <TabletButton
          className="flex-1"
          disabled={uploading || !!uploadDisabledReason}
          onClick={() => chooseRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Upload className="h-5 w-5" />
          )}
          Upload / Choose Photos
        </TabletButton>
        <TabletButton
          variant="outline"
          className="flex-1"
          disabled={uploading || !!uploadDisabledReason}
          onClick={() => setCameraOpen(true)}
        >
          <Camera className="h-5 w-5" /> Take Photos
        </TabletButton>
      </div>

      {uploadDisabledReason ? (
        <p className="text-sm text-muted-foreground">{uploadDisabledReason}</p>
      ) : null}

      <MultiShotCamera
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(photos) => handleFiles(photos)}
      />

      {/* Gallery */}
      {docs.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : docs.isError ? (
        <p className="py-10 text-center text-destructive">
          Could not load files. Check the connection.
        </p>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          No files yet. Upload a photo or PDF to get started.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((doc) => (
            <TabletCard key={doc.id} variant="flat" className="p-2">
              <button
                type="button"
                className="block w-full overflow-hidden rounded-xl bg-muted"
                onClick={() => setViewing(doc)}
              >
                {isImage(doc.fileType) ? (
                  <img
                    src={doc.fileUrl}
                    alt={doc.fileName}
                    className="h-32 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-32 w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                    <FileText className="h-10 w-10" />
                    <span className="text-xs">
                      {isPdf(doc.fileType) ? "PDF" : "File"}
                    </span>
                  </div>
                )}
              </button>
              <div className="mt-2 flex items-center justify-between gap-1">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-muted-foreground">
                    {shortDate(doc.uploadedAt)}
                  </span>
                  {doc.latitude != null && doc.longitude != null && (
                    <a
                      href={googleMapsUrl({
                        latitude: doc.latitude,
                        longitude: doc.longitude,
                        accuracy: null,
                        capturedAt: "",
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-[10px] text-emerald-700 hover:underline"
                    >
                      GPS: {doc.latitude.toFixed(4)}, {doc.longitude.toFixed(4)}
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Download"
                  className="rounded-lg p-2 text-foreground/70 hover:bg-accent"
                  onClick={() => downloadDoc(doc)}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(doc)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </TabletCard>
          ))}
        </div>
      )}

      {/* Full-size viewer */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{viewing?.fileName}</DialogTitle>
          </DialogHeader>
          {viewing ? (
            isImage(viewing.fileType) ? (
              <img
                src={viewing.fileUrl}
                alt={viewing.fileName}
                className="max-h-[70vh] w-full object-contain"
              />
            ) : (
              <iframe
                title={viewing.fileName}
                src={viewing.fileUrl}
                className="h-[70vh] w-full rounded-lg border"
              />
            )
          ) : null}
          <div className="flex justify-end">
            <TabletButton
              onClick={() => viewing && downloadDoc(viewing)}
              disabled={!viewing}
            >
              <Download className="h-5 w-5" /> Download
            </TabletButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
