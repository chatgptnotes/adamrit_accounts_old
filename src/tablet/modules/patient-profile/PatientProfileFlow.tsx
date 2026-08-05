import { useState } from "react";
import { useDebounce } from "use-debounce";
import { Loader2, Search, User } from "lucide-react";
import { usePatientSearch, type TabletPatient } from "@/tablet/hooks/usePatients";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { PullToRefresh } from "@/tablet/components/PullToRefresh";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { cn } from "@/lib/utils";
import { ClinicNotesTab } from "@/tablet/modules/patient-profile/ClinicNotesTab";
import { PatientDocsTab } from "@/tablet/modules/patient-profile/PatientDocsTab";
import {
  DOCUMENTS_AND_PHOTOS_CATEGORIES,
  type PatientDocCategory,
} from "@/tablet/hooks/usePatientDocs";
import {
  buildRegistrationDocumentNotes,
  getCorporateRegistrationDocuments,
  REGISTRATION_DOCUMENT_CATEGORY,
} from "@/lib/registrationDocuments";

/**
 * Tabs shown under a selected patient: profile details + one per doc category.
 * Includes Registration Documents so panel documents can be uploaded here.
 */
const TABS = [
  { id: "profile", label: "Patient Profile" },
  { id: "clinic-notes", label: "Clinic Notes" },
  ...DOCUMENTS_AND_PHOTOS_CATEGORIES,
] as const;

/** A single labelled read-only field in the profile grid. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{value || "—"}</dd>
    </div>
  );
}

/** Searchable list of every patient in the active hospital (old & new, all types). */
function PatientList({ onSelect }: { onSelect: (p: TabletPatient) => void }) {
  const [term, setTerm] = useState("");
  const [debounced] = useDebounce(term, 300);
  const patients = usePatientSearch(debounced);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 border-b p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by name, patient ID or phone"
            className="pl-11"
          />
        </div>
      </div>
      <PullToRefresh className="p-4">
        {patients.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : patients.isError ? (
          <p className="py-10 text-center text-destructive">
            Could not load patients. Check the connection.
          </p>
        ) : (patients.data || []).length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            {debounced.trim() ? "No matches." : "No patients found."}
          </p>
        ) : (
          <div className="space-y-3">
            {(patients.data || []).map((p) => (
              <TabletCard
                key={p.id}
                interactive
                onClick={() => onSelect(p)}
                className="flex items-center gap-3"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.patientsId || "No ID"}
                    {p.age != null ? ` · ${p.age}/${p.gender || "—"}` : ""}
                  </p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <p>{shortDate(p.registeredAt)}</p>
                  {p.phone ? <p className="text-xs">{p.phone}</p> : null}
                </div>
              </TabletCard>
            ))}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
}

/** Patient Profile — search any Hope patient (old & new) and view their details. */
export default function PatientProfileFlow() {
  const [selected, setSelected] = useState<TabletPatient | null>(null);
  const [tab, setTab] = useState<string>("profile");
  const [registrationDocumentName, setRegistrationDocumentName] = useState("");

  const isRegistrationTab = tab === REGISTRATION_DOCUMENT_CATEGORY;
  const isClinicNotesTab = tab === "clinic-notes";
  const requiredDocuments = selected
    ? getCorporateRegistrationDocuments(selected.corporate || "")
    : [];

  if (!selected) {
    return <PatientList onSelect={setSelected} />;
  }

  return (
    <FlowScaffold
      heading="Patient Profile"
      subheading={`${selected.name} · ${selected.patientsId || "No ID"}`}
      actions={
        <TabletButton
          variant="outline"
          className="flex-1"
          onClick={() => {
            setSelected(null);
            setTab("profile");
            setRegistrationDocumentName("");
          }}
        >
          Back
        </TabletButton>
      }
    >
      <div className="space-y-4">
        {/* Sticky segmented tab bar */}
        <div className="sticky top-0 z-20 -mx-4 border-b bg-background/80 px-4 pb-2 pt-1 backdrop-blur">
          <div
            role="tablist"
            className="tablet-no-scrollbar flex gap-2 overflow-x-auto"
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setTab(t.id);
                    setRegistrationDocumentName("");
                  }}
                  className={cn(
                    "min-h-[44px] shrink-0 rounded-full border px-5 text-base font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow"
                      : "border-border bg-card text-foreground/80 hover:bg-accent",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === "profile" ? (
          <>
            <div className="border-b pb-3">
              <h3 className="text-lg font-bold">{selected.name}</h3>
              <p className="text-sm text-muted-foreground">
                {selected.patientsId || "No patient ID"}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Patient ID" value={selected.patientsId} />
              <Field
                label="Age / Gender"
                value={
                  selected.age != null
                    ? `${selected.age} / ${selected.gender || "—"}`
                    : selected.gender
                }
              />
              <Field
                label="Date of Birth"
                value={shortDate(selected.dateOfBirth)}
              />
              <Field label="Blood Group" value={selected.bloodGroup} />
              <Field label="Phone" value={selected.phone} />
              <Field label="Email" value={selected.email} />
              <Field label="City" value={selected.city} />
              <Field label="State" value={selected.state} />
              <Field
                label="Registered On"
                value={shortDate(selected.registeredAt)}
              />
              <div className="col-span-2">
                <Field label="Address" value={selected.address} />
              </div>
            </dl>
          </>
        ) : isClinicNotesTab ? (
          <ClinicNotesTab patientId={selected.id} patientName={selected.name} />
        ) : (
          <>
            {/* Registration documents are identified by name, not filename. The
                checklist and the pending-document bell match on that name, so
                an upload without one would stay Pending forever. */}
            {isRegistrationTab ? (
              requiredDocuments.length > 0 ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor="registration-document-name"
                    className="text-sm font-medium text-muted-foreground"
                  >
                    Which document is this?
                  </label>
                  <select
                    id="registration-document-name"
                    value={registrationDocumentName}
                    onChange={(e) => setRegistrationDocumentName(e.target.value)}
                    className="min-h-[48px] w-full rounded-xl border border-border bg-card px-3 text-base font-medium"
                  >
                    <option value="">Select a document…</option>
                    {requiredDocuments.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  No mandatory documents are defined for “{selected.corporate || "no panel"}”, so
                  uploads here cannot be named. Use the Panel Documents screen for panel patients.
                </p>
              )
            ) : null}

            <PatientDocsTab
              patientId={selected.id}
              patientName={selected.name}
              category={tab as PatientDocCategory}
              label={TABS.find((t) => t.id === tab)?.label || ""}
              uploadNotes={
                isRegistrationTab && registrationDocumentName
                  ? buildRegistrationDocumentNotes({
                      source: "patient_registration",
                      corporate: selected.corporate || "",
                      documentName: registrationDocumentName,
                    })
                  : null
              }
              uploadDisabledReason={
                isRegistrationTab && !registrationDocumentName
                  ? requiredDocuments.length > 0
                    ? "Select which document you are uploading first."
                    : "This patient's panel has no mandatory documents to upload."
                  : null
              }
            />
          </>
        )}
      </div>
    </FlowScaffold>
  );
}
