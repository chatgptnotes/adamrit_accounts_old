import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  PATIENT_DOC_CATEGORIES,
  type PatientDoc,
  type PatientDocCategory,
} from "@/tablet/hooks/usePatientDocs";

interface BillDocumentsSectionProps {
  patientId?: string;
  patientName?: string | null;
}

function isImage(type: string | null): boolean {
  return !!type && type.startsWith("image/");
}

function isPdf(type: string | null): boolean {
  return !!type && type.includes("pdf");
}

/** Blob download — same pattern as PatientDocsTab.downloadDoc. */
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

interface CategorizedDoc extends PatientDoc {
  category: string;
}

function mapDoc(r: any): CategorizedDoc {
  return {
    id: r.id,
    fileName: r.file_name ?? "file",
    fileUrl: r.file_url ?? "",
    fileType: r.file_type ?? null,
    storagePath: r.storage_path ?? null,
    uploadedAt: r.created_at ?? null,
    category: r.category ?? "",
  };
}

/** All uploaded docs for a patient, across the 8 profile categories, newest first. */
function usePatientAllDocs(patientId: string | undefined) {
  return useQuery({
    queryKey: ["bill-patient-docs", patientId],
    enabled: !!patientId,
    staleTime: 1000 * 15,
    queryFn: async (): Promise<CategorizedDoc[]> => {
      const { data, error } = await supabase
        .from("file_uploads")
        .select(
          "id, file_name, file_url, file_type, storage_path, created_at, category",
        )
        .eq("patient_id", patientId)
        .in(
          "category",
          PATIENT_DOC_CATEGORIES.map((c) => c.id),
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDoc);
    },
  });
}

/** Read-only gallery for one category: thumbnails, click to view, download. */
function CategoryGallery({
  items,
  onView,
}: {
  items: PatientDoc[];
  onView: (doc: PatientDoc) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No files uploaded.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((doc) => (
        <div key={doc.id} className="rounded-lg border p-2">
          <button
            type="button"
            className="block w-full overflow-hidden rounded-md bg-muted"
            onClick={() => onView(doc)}
          >
            {isImage(doc.fileType) ? (
              <img
                src={doc.fileUrl}
                alt={doc.fileName}
                className="h-28 w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-28 w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                <FileText className="h-9 w-9" />
                <span className="text-xs">{isPdf(doc.fileType) ? "PDF" : "File"}</span>
              </div>
            )}
          </button>
          <div className="mt-2 flex items-center justify-between gap-1">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {doc.fileName}
            </span>
            <button
              type="button"
              aria-label="Download"
              className="rounded-md p-1.5 text-foreground/70 hover:bg-accent"
              onClick={() => downloadDoc(doc)}
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A collapsible side panel next to the Yojna/Final Bill that lets staff view and
 * download the patient's uploaded photos/documents across the 8 profile categories.
 * Read-only — uploading/deleting is done from the tablet Patient Profile.
 */
export function BillDocumentsSection({
  patientId,
  patientName,
}: BillDocumentsSectionProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PatientDocCategory>(
    PATIENT_DOC_CATEGORIES[0].id,
  );
  const [viewing, setViewing] = useState<PatientDoc | null>(null);
  const docs = usePatientAllDocs(patientId);

  // Group all docs by category so every tab (even empty ones) can render.
  const byCategory = new Map<string, PatientDoc[]>();
  for (const cat of PATIENT_DOC_CATEGORIES) byCategory.set(cat.id, []);
  for (const doc of docs.data || []) {
    if (byCategory.has(doc.category)) byCategory.get(doc.category)!.push(doc);
  }
  const total = docs.data?.length || 0;

  return (
    <div className="print:hidden rounded-lg border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-semibold">
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Documents &amp; Photos
          {total > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {total}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t p-4">
          {!patientId ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No patient linked to this bill.
            </p>
          ) : docs.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          ) : docs.isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Could not load documents. Check the connection.
            </p>
          ) : (
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as PatientDocCategory)}
            >
              <TabsList className="flex h-auto flex-wrap justify-start gap-1">
                {PATIENT_DOC_CATEGORIES.map((cat) => {
                  const count = byCategory.get(cat.id)?.length || 0;
                  return (
                    <TabsTrigger key={cat.id} value={cat.id} className="text-xs">
                      {cat.label}
                      {count > 0 && (
                        <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                          {count}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {PATIENT_DOC_CATEGORIES.map((cat) => (
                <TabsContent key={cat.id} value={cat.id}>
                  <CategoryGallery
                    items={byCategory.get(cat.id) || []}
                    onView={setViewing}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      )}

      {/* Full-size viewer */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">
              {viewing?.fileName || patientName || "Document"}
            </DialogTitle>
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
            <button
              type="button"
              onClick={() => viewing && downloadDoc(viewing)}
              disabled={!viewing}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Download
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BillDocumentsSection;
