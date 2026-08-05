import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileText, Loader2, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { shortDate } from "@/tablet/lib/format";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletLabel } from "@/tablet/ui/TabletInput";
import { DictationTextarea } from "@/tablet/components/DictationTextarea";
import { publishGeneratedPatientReport } from "@/lib/generatedPatientReports";
import { PatientDocsTab } from "@/tablet/modules/patient-profile/PatientDocsTab";
import { usePatientDocs } from "@/tablet/hooks/usePatientDocs";

const LETTERHEAD_URL = "/hope-letterhead.png";

function clinicNotesMarker(patientId: string) {
  return `clinic_notes:${patientId}`;
}

function clinicNotesPhotoMarker(patientId: string) {
  return `clinic_notes_photo:${patientId}`;
}

function buildSections(noteText: string) {
  const lines = noteText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return [
    {
      title: "Clinic note",
      lines: lines.length > 0 ? lines : ["-"],
    },
  ];
}

export function ClinicNotesTab({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const marker = useMemo(() => clinicNotesMarker(patientId), [patientId]);
  const photoMarker = useMemo(() => clinicNotesPhotoMarker(patientId), [patientId]);
  const notes = usePatientDocs(patientId, "clinic_notes", marker);
  const latest = notes.data?.[0] || null;

  const save = useMutation({
    mutationFn: async () => {
      const text = draft.trim();
      if (!text) throw new Error("Write or dictate a clinic note first.");

      const ok = await publishGeneratedPatientReport({
        category: "clinic_notes",
        patientId,
        patientName: patientName || "Unnamed patient",
        title: "Clinic Notes",
        subtitle: "System-generated with hospital letterhead",
        notes: marker,
        letterheadUrl: LETTERHEAD_URL,
        sections: buildSections(text),
      });
      if (!ok) throw new Error("Could not generate the clinic note PDF.");
    },
    onSuccess: async () => {
      setDraft("");
      await qc.invalidateQueries({
        queryKey: ["tablet-patient-docs", patientId, "clinic_notes"],
      });
      toast({
        title: "Clinic note saved",
        description: "The PDF was generated with the hospital letterhead.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not save clinic note",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4">
      <TabletCard className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          <p className="font-semibold">Clinic note photo</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Capture or upload the doctor’s handwritten note. This stays with the clinic-notes tab.
        </p>
        <PatientDocsTab
          patientId={patientId}
          patientName={patientName}
          category="clinic_notes"
          label="Clinic note photo"
          uploadNotes={photoMarker}
          latestOnly
          compact
        />
      </TabletCard>

      <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <p className="font-semibold">Clinic notes</p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Type the note or use the mic. Saving will generate a hospital-letterhead PDF.
        </p>
      </div>

      <div>
        <TabletLabel htmlFor="clinic-note-text">Clinic note text</TabletLabel>
        <DictationTextarea
          id="clinic-note-text"
          value={draft}
          onChange={setDraft}
          rows={10}
          placeholder="Enter clinic note here or dictate it with the mic…"
        />
      </div>

      <div className="flex gap-2">
        <TabletButton
          className="flex-1"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
          {save.isPending ? "Generating PDF…" : "Save clinic note"}
        </TabletButton>
        <TabletButton
          variant="outline"
          className="flex-1"
          onClick={() => setDraft("")}
          disabled={save.isPending || !draft.trim()}
        >
          Clear
        </TabletButton>
      </div>

      <TabletCard className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Latest saved note</p>
            <p className="text-xs text-muted-foreground">
              {notes.isLoading
                ? "Loading…"
                : latest
                  ? `Uploaded · ${shortDate(latest.uploadedAt)}`
                  : "No clinic note saved yet."}
            </p>
          </div>
          {latest ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              onClick={() => window.open(latest.fileUrl, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open PDF
            </button>
          ) : null}
        </div>
        {latest ? (
          <div className="rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {latest.displayName || latest.fileName}
          </div>
        ) : null}
      </TabletCard>
    </div>
  );
}
