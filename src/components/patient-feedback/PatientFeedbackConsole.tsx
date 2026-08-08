import { useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { TabletPatientPicker } from "@/tablet/components/TabletPatientPicker";
import { usePatientFeedbackList } from "@/hooks/usePatientFeedback";
import { FeedbackGrid } from "./FeedbackMediaCard";
import { FeedbackUploadPanel } from "./FeedbackUploadPanel";

/** The selected patient's feedback, with the uploader above it. */
function PatientTab() {
  const [patient, setPatient] = useState<Patient | null>(null);
  const { data = [], isLoading } = usePatientFeedbackList(patient?.id);

  if (!patient) {
    return (
      <TabletPatientPicker
        onSelect={setPatient}
        heading="Search a patient"
        hint="Find the patient, then upload their photo or video feedback."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{patient.name}</p>
          <p className="text-sm text-muted-foreground">
            {patient.patients_id || "—"}
            {patient.age != null ? ` · ${patient.age}y` : ""}
            {patient.gender ? ` · ${patient.gender}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPatient(null)}>
          <X className="mr-1 h-4 w-4" />
          Change
        </Button>
      </div>

      <FeedbackUploadPanel patientId={patient.id} patientName={patient.name} />

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <FeedbackGrid
          items={data}
          emptyMessage="Nothing uploaded for this patient yet."
        />
      )}
    </div>
  );
}

/** Everything uploaded, newest first, searchable by patient name or caption. */
function AllTab() {
  const [term, setTerm] = useState("");
  const { data = [], isLoading } = usePatientFeedbackList();

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (item) =>
        (item.patientName || "").toLowerCase().includes(q) ||
        (item.caption || "").toLowerCase().includes(q),
    );
  }, [data, term]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search patient or caption…"
          className="h-14 w-full rounded-xl border border-border bg-card pl-11 pr-4 text-lg text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <FeedbackGrid
          items={filtered}
          showPatientName
          emptyMessage={
            term ? "No feedback matches your search." : "No feedback uploaded yet."
          }
        />
      )}
    </div>
  );
}

/**
 * Patient feedback console — shared by the tablet tile and the desktop page so
 * both editions stay the same screen.
 */
export function PatientFeedbackConsole() {
  return (
    <Tabs defaultValue="patient" className="space-y-4">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="patient">This patient</TabsTrigger>
        <TabsTrigger value="all">All feedback</TabsTrigger>
      </TabsList>
      <TabsContent value="patient" className="mt-0">
        <PatientTab />
      </TabsContent>
      <TabsContent value="all" className="mt-0">
        <AllTab />
      </TabsContent>
    </Tabs>
  );
}
