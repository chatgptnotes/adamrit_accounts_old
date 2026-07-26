import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { panelFor } from "@/tablet/lib/panelColors";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { haptics } from "@/tablet/lib/haptics";
import {
  deletePatientDoc,
  uploadPatientDocs,
  usePatientDocs,
  type PatientDoc,
} from "@/tablet/hooks/usePatientDocs";
import {
  buildRegistrationDocumentNotes,
  getCorporateRegistrationDocuments,
  normalizeCorporateName,
  parseRegistrationDocumentNotes,
  REGISTRATION_DOCUMENT_CATEGORY,
} from "@/lib/registrationDocuments";
import {
  PANEL_DOCUMENT_BELL_QUERY_KEY,
  PANEL_DOCUMENT_QUERY_KEY,
  useUnwaivePanelDocument,
  useWaivePanelDocument,
} from "@/hooks/usePanelDocuments";
import type { PanelDocumentStatusRow } from "@/lib/panelDocumentsDb";

type DocumentState = "submitted" | "pending" | "not_applicable";

interface ChecklistItem {
  name: string;
  state: DocumentState;
  upload: PatientDoc | null;
}

const STATE_LABEL: Record<DocumentState, string> = {
  submitted: "Submitted",
  pending: "Pending",
  not_applicable: "Not Applicable",
};

const STATE_STYLE: Record<DocumentState, string> = {
  submitted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  not_applicable: "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300",
};

const STATE_ICON: Record<DocumentState, typeof Check> = {
  submitted: Check,
  pending: Clock,
  not_applicable: Ban,
};

/**
 * One patient's panel document checklist.
 *
 * Submitted/Pending is derived here exactly as the RPC derives it — required
 * document names paired against uploads by their notes JSON documentName — so
 * this screen can never contradict the list it was opened from. Only the
 * Not Applicable marks come from the database.
 */
export function PanelDocumentChecklist({
  row,
  onBack,
}: {
  row: PanelDocumentStatusRow;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busyDocument, setBusyDocument] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: uploads = [],
    isLoading,
    error,
  } = usePatientDocs(row.patientUuid, REGISTRATION_DOCUMENT_CATEGORY);

  const waive = useWaivePanelDocument();
  const unwaive = useUnwaivePanelDocument();

  const panel = panelFor(row.corporate);

  const items = useMemo<ChecklistItem[]>(() => {
    const required = getCorporateRegistrationDocuments(row.corporate || "");

    // Newest upload wins — usePatientDocs already orders created_at desc.
    const uploadByDocument = new Map<string, PatientDoc>();
    for (const upload of uploads) {
      const documentName = parseRegistrationDocumentNotes(upload.notes)?.documentName;
      if (!documentName) continue;
      const key = normalizeCorporateName(documentName);
      if (!uploadByDocument.has(key)) uploadByDocument.set(key, upload);
    }

    const waived = new Set(row.waivedDocuments.map(normalizeCorporateName));

    return required.map((name) => {
      const key = normalizeCorporateName(name);
      const upload = uploadByDocument.get(key) ?? null;
      // Submitted beats waived: a document marked N/A and later uploaded is
      // Submitted, not still N/A.
      const state: DocumentState = upload
        ? "submitted"
        : waived.has(key)
          ? "not_applicable"
          : "pending";
      return { name, state, upload };
    });
  }, [row.corporate, row.waivedDocuments, uploads]);

  const pendingCount = items.filter((item) => item.state === "pending").length;
  const submittedCount = items.filter((item) => item.state === "submitted").length;

  const refreshAll = () => {
    queryClient.invalidateQueries({
      queryKey: ["tablet-patient-docs", row.patientUuid, REGISTRATION_DOCUMENT_CATEGORY],
    });
    queryClient.invalidateQueries({ queryKey: PANEL_DOCUMENT_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: PANEL_DOCUMENT_BELL_QUERY_KEY });
  };

  const runAction = async (documentName: string, action: () => Promise<unknown>) => {
    setBusyDocument(documentName);
    setActionError(null);
    try {
      await action();
      refreshAll();
      haptics.tap();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setBusyDocument(null);
    }
  };

  const handleUpload = (documentName: string, file: File | undefined) => {
    if (!file) return;
    void runAction(documentName, () =>
      uploadPatientDocs([file], {
        patientId: row.patientUuid,
        patientName: row.patientName,
        category: REGISTRATION_DOCUMENT_CATEGORY,
        uploadedBy: user?.id ?? null,
        // Without these notes the upload is invisible to the derivation and the
        // document would stay Pending forever.
        notes: buildRegistrationDocumentNotes({
          source: "patient_registration",
          corporate: row.corporate || "",
          documentName,
        }),
      }),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-shrink-0 space-y-3 border-b p-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </button>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{row.patientName}</h1>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", panel.badge)}>
              {row.panel}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {row.patientsId || "No UHID"}
            {row.corporate ? ` · ${row.corporate}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className={cn("rounded-full px-2.5 py-1", STATE_STYLE.submitted)}>
            {submittedCount} submitted
          </span>
          <span className={cn("rounded-full px-2.5 py-1", STATE_STYLE.pending)}>
            {pendingCount} pending
          </span>
          {row.waivedCount > 0 ? (
            <span className={cn("rounded-full px-2.5 py-1", STATE_STYLE.not_applicable)}>
              {row.waivedCount} not applicable
            </span>
          ) : null}
        </div>
      </div>

      <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {actionError ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionError}
          </p>
        ) : null}

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="py-10 text-center text-destructive">
            Could not load this patient's uploaded documents.
          </p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            No mandatory documents are defined for “{row.corporate || "no panel"}”.
          </p>
        ) : (
          items.map((item) => {
            const StateIcon = STATE_ICON[item.state];
            const isBusy = busyDocument === item.name;

            return (
              <TabletCard key={item.name} variant="flat" className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 text-sm font-semibold leading-snug">{item.name}</h3>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      STATE_STYLE[item.state],
                    )}
                  >
                    <StateIcon className="h-3.5 w-3.5" />
                    {STATE_LABEL[item.state]}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isBusy ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Working…
                    </span>
                  ) : (
                    <>
                      {item.upload ? (
                        <>
                          <a
                            href={item.upload.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            View
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(item.name, () => deletePatientDoc(item.upload!))
                            }
                            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-destructive/40 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </>
                      ) : (
                        <label className="flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted">
                          <Upload className="h-3.5 w-3.5" />
                          Upload
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            className="hidden"
                            onChange={(e) => {
                              handleUpload(item.name, e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}

                      {item.state === "not_applicable" ? (
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(item.name, () =>
                              unwaive.mutateAsync({
                                patientUuid: row.patientUuid,
                                documentName: item.name,
                              }),
                            )
                          }
                          className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Undo N/A
                        </button>
                      ) : item.state === "pending" ? (
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(item.name, () =>
                              waive.mutateAsync({
                                patientUuid: row.patientUuid,
                                documentName: item.name,
                                corporate: row.corporate,
                              }),
                            )
                          }
                          className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Mark N/A
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </TabletCard>
            );
          })
        )}
      </div>
    </div>
  );
}
