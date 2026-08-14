import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle, Check, ChevronLeft, FileText, Link2, Loader2, Megaphone, Paperclip,
  Plus, Search, Upload, UserPlus, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletPatientPicker } from "@/tablet/components/TabletPatientPicker";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { RefereePicker } from "./RefereePicker";

// DATA SOURCE: incoming_referrals — announced before arrival, linked to the
// real registration when the patient reaches. The link stamp is the claim.

interface ReferralDoc {
  name: string;
  url: string;
  category: string;
}

interface Announcement {
  id: string;
  patient_name: string;
  coming_from: string | null;
  referee_initials: string | null;
  is_direct: boolean;
  documents: ReferralDoc[];
  status: "ANNOUNCED" | "LINKED" | "CANCELLED";
  announced_by: string | null;
  patient_id: string | null;
  patient_uhid: string | null;
  patient_mobile: string | null;
  linked_visit_id: string | null;
  linked_by: string | null;
  created_at: string;
}

/** The blocking "already announced" popup. `canOverride` only for a name-only clash. */
interface BlockedAlert {
  message: string;
  canOverride: boolean;
}

/** nisha@gmail.com reads back as "Nisha" — the same shape the list already uses. */
const displayName = (account: string | null) => {
  const handle = (account || "").split("@")[0];
  return handle ? handle.charAt(0).toUpperCase() + handle.slice(1) : "another user";
};

const DOC_CATEGORIES = ["Aadhaar", "Referral slip", "Discharge summary", "Other"] as const;

const BUCKET = "uploads";

/** The front office works off the last two days of arrivals. */
const WINDOW_HOURS = 48;

async function uploadReferralDoc(file: File, category: string): Promise<ReferralDoc> {
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: file must be 12 MB or smaller`);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `incoming-referrals/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { name: file.name, url: data.publicUrl, category };
}

/**
 * Incoming referral announcements. A marketing executive announces a
 * referred patient before arrival — name, place, referee initials, documents
 * — so the claim is visible to everyone and cannot be doubled. When the
 * patient arrives and is registered through the normal Register tile, the
 * announcement is linked to that registration with the patient picker.
 */
export default function IncomingReferralsFlow() {
  const { user, hospitalType } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"list" | "announce">("list");
  const [linkFor, setLinkFor] = useState<Announcement | null>(null);
  const [searchHospital, setSearchHospital] = useState<"hope" | "ayushman">(
    hospitalType === "ayushman" ? "ayushman" : "hope",
  );
  const [form, setForm] = useState({
    patientName: "", comingFrom: "", refereeInitials: "", patientMobile: "",
  });
  const [isDirect, setIsDirect] = useState(false);
  const [docs, setDocs] = useState<ReferralDoc[]>([]);
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  // Set only when the announcer recognises a returning patient and picks them
  // from the search — that is the one moment a real UHID exists before arrival.
  const [pickedPatient, setPickedPatient] = useState<Patient | null>(null);
  const [searchingPatient, setSearchingPatient] = useState(false);
  const [blocked, setBlocked] = useState<BlockedAlert | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const resetForm = () => {
    setForm({ patientName: "", comingFrom: "", refereeInitials: "", patientMobile: "" });
    setIsDirect(false);
    setDocs([]);
    setPickedPatient(null);
    setSearchingPatient(false);
  };

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["incoming-referrals"],
    queryFn: async (): Promise<Announcement[]> => {
      // The last 48 hours, plus every still-awaited announcement however old —
      // an unlinked claim must never fall off the list unnoticed.
      const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase as any)
        .from("incoming_referrals")
        .select("id, patient_name, coming_from, referee_initials, is_direct, documents, status, announced_by, patient_id, patient_uhid, patient_mobile, linked_visit_id, linked_by, created_at")
        .neq("status", "CANCELLED")
        .or(`created_at.gte.${since},status.eq.ANNOUNCED`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as Announcement[];
    },
  });

  const announce = useMutation({
    // `force` only ever comes from the "different person" button on a
    // name-only clash; an id or mobile clash is refused whatever it says.
    mutationFn: async (force: boolean = false) => {
      if (!form.patientName.trim()) throw new Error("Enter the patient's name");
      if (!isDirect && !form.refereeInitials.trim()) throw new Error("Choose the RM or referee");
      // The duplicate check and the insert must be one step: RLS on this table
      // is fully permissive, so a check made here alone loses the race between
      // two tablets announcing the same patient at the same moment.
      const { error } = await (supabase as any).rpc("announce_incoming_referral", {
        p_patient_name: form.patientName.trim(),
        p_coming_from: form.comingFrom.trim() || null,
        p_referee_initials: isDirect ? null : form.refereeInitials.trim(),
        p_is_direct: isDirect,
        p_documents: docs,
        p_announced_by: user?.email || user?.id || null,
        p_patient_id: pickedPatient?.id ?? null,
        p_patient_uhid: pickedPatient?.patients_id ?? null,
        p_patient_mobile: form.patientMobile.trim() || null,
        p_force_name: force,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        isDirect
          ? `Announced — ${form.patientName.trim()} is a direct walk-in.`
          : `Announced — ${form.patientName.trim()} is on the way.`,
      );
      resetForm();
      setMode("list");
      queryClient.invalidateQueries({ queryKey: ["incoming-referrals"] });
    },
    onError: (e: any) => {
      const message = e?.message || "Could not announce";
      if (message.includes("ALREADY_ANNOUNCED_NAME:")) {
        setBlocked({ message: message.split("ALREADY_ANNOUNCED_NAME: ")[1], canOverride: true });
      } else if (message.includes("ALREADY_ANNOUNCED:")) {
        setBlocked({ message: message.split("ALREADY_ANNOUNCED: ")[1], canOverride: false });
      } else if (e?.code === "23505") {
        // The backstop index caught a simultaneous announce.
        setBlocked({
          message: "This patient was just announced by someone else and cannot be registered again.",
          canOverride: false,
        });
      } else {
        toast.error(message);
      }
    },
  });

  const link = useMutation({
    mutationFn: async ({ announcement, patient }: { announcement: Announcement; patient: Patient }) => {
      // Without this the announce guard is dodged by announcing under a
      // different spelling and then linking to the same registration. One
      // patient, one live incoming referral — enforced at both ends.
      const { data: claimed } = await (supabase as any)
        .from("incoming_referrals")
        .select("id, announced_by, referee_initials")
        .neq("status", "CANCELLED")
        .neq("id", announcement.id)
        .or(`patient_id.eq.${patient.id},linked_patient_id.eq.${patient.id}`)
        .limit(1);
      if (claimed?.length) {
        const owner = displayName(claimed[0].announced_by);
        const referee = claimed[0].referee_initials ? ` (referee ${claimed[0].referee_initials})` : "";
        throw new Error(
          `ALREADY_ANNOUNCED: This patient is already registered by ${owner}${referee} and cannot be registered again.`,
        );
      }

      // The registered patient's latest visit, so the claim points at the
      // actual OPD/IPD registration.
      const { data: visits } = await (supabase as any)
        .from("visits")
        .select("visit_id")
        .eq("patient_id", patient.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const { error, data } = await (supabase as any)
        .from("incoming_referrals")
        .update({
          status: "LINKED",
          linked_patient_id: patient.id,
          linked_visit_id: visits?.[0]?.visit_id ?? null,
          linked_by: user?.email || user?.id || null,
          linked_at: new Date().toISOString(),
        })
        .eq("id", announcement.id)
        .eq("status", "ANNOUNCED") // a claim can be made once
        .select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("This announcement was already linked by someone else.");

      // A walk-in announcement marks the patient direct, the same flag
      // Rupali's Direct Patient tile sets — so no referee can be attached to
      // them later. Reversible from that tile if it was announced wrongly.
      if (announcement.is_direct) {
        const { error: directError } = await (supabase as any)
          .from("patients")
          .update({
            is_direct: true,
            direct_marked_by: user?.email || user?.id || null,
            direct_marked_at: new Date().toISOString(),
          })
          .eq("id", patient.id);
        if (directError) throw new Error(directError.message);
      }
      return { patient, wasDirect: announcement.is_direct };
    },
    onSuccess: ({ patient, wasDirect }) => {
      toast.success(
        wasDirect
          ? `Linked — ${patient.name} is marked a direct patient.`
          : `Linked to ${patient.name}'s registration.`,
      );
      setLinkFor(null);
      queryClient.invalidateQueries({ queryKey: ["incoming-referrals"] });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "Could not link";
      if (message.includes("ALREADY_ANNOUNCED:")) {
        setBlocked({ message: message.split("ALREADY_ANNOUNCED: ")[1], canOverride: false });
      } else {
        toast.error(message);
      }
    },
  });

  const attachDoc = async (category: string, files: FileList | null) => {
    if (!files?.length) return;
    setUploadingCategory(category);
    try {
      const uploaded: ReferralDoc[] = [];
      for (const file of Array.from(files)) uploaded.push(await uploadReferralDoc(file, category));
      setDocs((prev) => [...prev, ...uploaded]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingCategory(null);
      const input = fileRefs.current[category];
      if (input) input.value = "";
    }
  };

  // The block popup. Rendered in every branch so it survives whichever screen
  // raised it, and OK only dismisses it — the form underneath keeps its data
  // and nothing was written.
  const blockedDialog = (
    <Dialog open={!!blocked} onOpenChange={(open) => (open ? null : setBlocked(null))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            Patient Already Registered
          </DialogTitle>
        </DialogHeader>
        <p className="text-base leading-relaxed">{blocked?.message}</p>
        <div className="space-y-2">
          <TabletButton className="w-full" onClick={() => setBlocked(null)}>
            OK
          </TabletButton>
          {blocked?.canOverride && (
            <TabletButton
              variant="outline"
              size="default"
              className="min-h-[44px] w-full text-sm text-muted-foreground"
              disabled={announce.isPending}
              onClick={() => {
                setBlocked(null);
                announce.mutate(true);
              }}
            >
              This is a different person — announce anyway
            </TabletButton>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  // ---- Existing-patient search: gives the announcement a real UHID ----
  if (searchingPatient) {
    return (
      <FlowScaffold
        heading="Find the patient"
        subheading="Only for someone who has been treated here before — it gives the announcement a UHID"
        actions={
          <TabletButton variant="outline" onClick={() => setSearchingPatient(false)}>
            <ChevronLeft className="mr-1 h-5 w-5" /> Back
          </TabletButton>
        }
      >
        <TabletPatientPicker
          heading="Registered patient"
          hint="Search by name, patient ID or mobile number"
          hospital={searchHospital}
          onHospitalChange={setSearchHospital}
          onSelect={(patient) => {
            setPickedPatient(patient);
            setForm((f) => ({
              ...f,
              patientName: patient.name,
              patientMobile: f.patientMobile || patient.phone || "",
            }));
            setSearchingPatient(false);
          }}
        />
        {blockedDialog}
      </FlowScaffold>
    );
  }

  // ---- Link overlay: pick the registered patient ----
  if (linkFor) {
    return (
      <FlowScaffold
        heading={`Link ${linkFor.patient_name}`}
        subheading="Find the registration made when the patient arrived (OPD or IPD)"
        actions={
          <TabletButton variant="outline" onClick={() => setLinkFor(null)} disabled={link.isPending}>
            <ChevronLeft className="mr-1 h-5 w-5" /> Back
          </TabletButton>
        }
      >
        <TabletPatientPicker
          heading="Registered patient"
          hint="Search by name, patient ID or mobile number"
          hospital={searchHospital}
          onHospitalChange={setSearchHospital}
          onSelect={(patient) => link.mutate({ announcement: linkFor, patient })}
        />
        {blockedDialog}
      </FlowScaffold>
    );
  }

  // ---- Announce form ----
  if (mode === "announce") {
    return (
      <FlowScaffold
        heading="Announce incoming patient"
        subheading="Everyone sees this the moment it is saved — the claim is yours"
        actions={
          <div className="flex w-full gap-3">
            <TabletButton variant="outline" onClick={() => setMode("list")} disabled={announce.isPending}>
              <ChevronLeft className="mr-1 h-5 w-5" /> Back
            </TabletButton>
            <TabletButton
              className="flex-1"
              disabled={announce.isPending}
              onClick={() => announce.mutate(false)}
            >
              <Megaphone className="mr-2 h-5 w-5" />
              {announce.isPending ? "Announcing…" : "Announce"}
            </TabletButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <TabletLabel>Who is coming?</TabletLabel>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <TabletButton
                variant={isDirect ? "outline" : "default"}
                className="min-h-[64px]"
                onClick={() => setIsDirect(false)}
              >
                Referred — a referee sent them
              </TabletButton>
              <TabletButton
                variant={isDirect ? "default" : "outline"}
                className="min-h-[64px]"
                onClick={() => setIsDirect(true)}
              >
                Direct — walk-in, no referee
              </TabletButton>
            </div>
          </div>
          <div>
            <TabletLabel>Treated here before?</TabletLabel>
            {pickedPatient ? (
              <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-primary/40 bg-primary/5 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{pickedPatient.name}</p>
                  <p className="font-mono text-xs tracking-wider text-muted-foreground">
                    {pickedPatient.patients_id || "no patient ID"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Clear the linked patient"
                  className="shrink-0 rounded-full p-2 text-muted-foreground"
                  onClick={() => setPickedPatient(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <TabletButton
                variant="outline"
                className="mt-2 w-full"
                onClick={() => setSearchingPatient(true)}
              >
                <Search className="mr-2 h-5 w-5" /> Search existing patient
              </TabletButton>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Optional — attaches the patient's UHID so nobody can announce them twice.
            </p>
          </div>
          <div>
            <TabletLabel>Patient name</TabletLabel>
            <TabletInput
              value={form.patientName}
              onChange={(e) => setForm((f) => ({ ...f, patientName: e.target.value }))}
              placeholder={isDirect ? "As given at the front desk" : "As told by the referee"}
              autoFocus
            />
          </div>
          <div>
            <TabletLabel>Mobile number</TabletLabel>
            <TabletInput
              value={form.patientMobile}
              onChange={(e) => setForm((f) => ({ ...f, patientMobile: e.target.value }))}
              placeholder="10-digit mobile"
              inputMode="numeric"
            />
          </div>
          <div>
            <TabletLabel>Coming from (place)</TabletLabel>
            <TabletInput
              value={form.comingFrom}
              onChange={(e) => setForm((f) => ({ ...f, comingFrom: e.target.value }))}
              placeholder="e.g. Bhandara"
            />
          </div>
          {!isDirect && (
            <RefereePicker
              value={form.refereeInitials}
              onChange={(choice) =>
                setForm((f) => ({ ...f, refereeInitials: choice?.value ?? "" }))
              }
            />
          )}
          <div>
            <TabletLabel>Documents</TabletLabel>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {DOC_CATEGORIES.map((category) => (
                <div key={category}>
                  <input
                    ref={(el) => {
                      fileRefs.current[category] = el;
                    }}
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => void attachDoc(category, e.target.files)}
                  />
                  <TabletButton
                    variant="outline"
                    className="w-full"
                    disabled={uploadingCategory !== null}
                    onClick={() => fileRefs.current[category]?.click()}
                  >
                    {uploadingCategory === category ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-5 w-5" />
                    )}
                    {category}
                    {docs.filter((d) => d.category === category).length > 0 &&
                      ` (${docs.filter((d) => d.category === category).length})`}
                  </TabletButton>
                </div>
              ))}
            </div>
            {docs.length > 0 && (
              <div className="mt-2 space-y-1">
                {docs.map((doc, index) => (
                  <div key={`${doc.url}-${index}`} className="flex items-center gap-2 text-sm">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                    <span className="text-xs text-muted-foreground">{doc.category}</span>
                    <button
                      type="button"
                      className="text-xs font-medium text-destructive"
                      onClick={() => setDocs((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {blockedDialog}
      </FlowScaffold>
    );
  }

  // ---- List ----
  return (
    <FlowScaffold
      heading="Incoming Referrals"
      subheading="Announced in the last 48 hours — link each one when the patient is registered"
      actions={
        <TabletButton
          className="w-full"
          onClick={() => {
            resetForm();
            setMode("announce");
          }}
        >
          <Plus className="mr-2 h-5 w-5" /> Announce incoming patient
        </TabletButton>
      }
    >
      {isLoading ? (
        <p className="py-8 text-center text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : announcements.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          Nothing announced in the last 48 hours. Announce every arrival here first — referred
          or direct.
        </p>
      ) : (
        <div className="grid gap-2">
          {announcements.map((item) => (
            <TabletCard key={item.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{item.patient_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.patient_uhid ? `${item.patient_uhid} · ` : ""}
                    {item.patient_mobile ? `${item.patient_mobile} · ` : ""}
                    {item.coming_from ? `From ${item.coming_from} · ` : ""}
                    {item.is_direct ? "Walk-in" : `Referee ${item.referee_initials}`} ·{" "}
                    {format(new Date(item.created_at), "dd MMM, HH:mm")}
                    {item.announced_by ? ` · by ${item.announced_by.split("@")[0]}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.is_direct && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      Direct
                    </span>
                  )}
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold",
                      item.status === "LINKED"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800",
                    )}
                  >
                    {item.status === "LINKED" ? "Linked" : "Awaited"}
                  </span>
                </div>
              </div>

              {item.documents?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {item.documents.map((doc, index) => (
                    <a
                      key={`${doc.url}-${index}`}
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-primary"
                    >
                      <FileText className="h-3 w-3" /> {doc.category}
                    </a>
                  ))}
                </div>
              )}

              {item.status === "LINKED" ? (
                <p className="flex items-center gap-1 text-sm text-emerald-700">
                  <Check className="h-4 w-4" />
                  Registered{item.linked_visit_id ? ` — visit ${item.linked_visit_id}` : ""}
                  {item.linked_by ? ` · linked by ${item.linked_by.split("@")[0]}` : ""}
                </p>
              ) : (
                <div className="flex gap-2">
                  <TabletButton
                    variant="outline"
                    size="default"
                    className="min-h-[44px] flex-1 text-sm"
                    onClick={() => navigate("/register")}
                  >
                    <UserPlus className="mr-1 h-4 w-4" /> Register
                  </TabletButton>
                  <TabletButton
                    size="default"
                    className="min-h-[44px] flex-1 text-sm"
                    onClick={() => setLinkFor(item)}
                  >
                    <Link2 className="mr-1 h-4 w-4" /> Link registration
                  </TabletButton>
                </div>
              )}
            </TabletCard>
          ))}
        </div>
      )}
      {blockedDialog}
    </FlowScaffold>
  );
}
