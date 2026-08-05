import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Check, ChevronLeft, FileText, Link2, Loader2, Megaphone, Paperclip,
  Plus, Upload, UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletPatientPicker } from "@/tablet/components/TabletPatientPicker";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

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
  referee_initials: string;
  documents: ReferralDoc[];
  status: "ANNOUNCED" | "LINKED" | "CANCELLED";
  announced_by: string | null;
  linked_visit_id: string | null;
  linked_by: string | null;
  created_at: string;
}

const DOC_CATEGORIES = ["Aadhaar", "Referral slip", "Discharge summary", "Other"] as const;

const BUCKET = "uploads";

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
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"list" | "announce">("list");
  const [linkFor, setLinkFor] = useState<Announcement | null>(null);
  const [form, setForm] = useState({ patientName: "", comingFrom: "", refereeInitials: "" });
  const [docs, setDocs] = useState<ReferralDoc[]>([]);
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["incoming-referrals"],
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await (supabase as any)
        .from("incoming_referrals")
        .select("id, patient_name, coming_from, referee_initials, documents, status, announced_by, linked_visit_id, linked_by, created_at")
        .neq("status", "CANCELLED")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as Announcement[];
    },
  });

  const announce = useMutation({
    mutationFn: async () => {
      if (!form.patientName.trim()) throw new Error("Enter the patient's name");
      if (!form.refereeInitials.trim()) throw new Error("Enter the referee's initials");
      const { error } = await (supabase as any).from("incoming_referrals").insert({
        patient_name: form.patientName.trim(),
        coming_from: form.comingFrom.trim() || null,
        referee_initials: form.refereeInitials.trim(),
        documents: docs,
        announced_by: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(`Announced — ${form.patientName.trim()} is on the way.`);
      setForm({ patientName: "", comingFrom: "", refereeInitials: "" });
      setDocs([]);
      setMode("list");
      queryClient.invalidateQueries({ queryKey: ["incoming-referrals"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not announce"),
  });

  const link = useMutation({
    mutationFn: async ({ announcement, patient }: { announcement: Announcement; patient: Patient }) => {
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
      return patient;
    },
    onSuccess: (patient) => {
      toast.success(`Linked to ${patient.name}'s registration.`);
      setLinkFor(null);
      queryClient.invalidateQueries({ queryKey: ["incoming-referrals"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not link"),
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
          onSelect={(patient) => link.mutate({ announcement: linkFor, patient })}
        />
      </FlowScaffold>
    );
  }

  // ---- Announce form ----
  if (mode === "announce") {
    return (
      <FlowScaffold
        heading="Announce incoming referral"
        subheading="Everyone sees this the moment it is saved — the claim is yours"
        actions={
          <div className="flex w-full gap-3">
            <TabletButton variant="outline" onClick={() => setMode("list")} disabled={announce.isPending}>
              <ChevronLeft className="mr-1 h-5 w-5" /> Back
            </TabletButton>
            <TabletButton
              className="flex-1"
              disabled={announce.isPending}
              onClick={() => announce.mutate()}
            >
              <Megaphone className="mr-2 h-5 w-5" />
              {announce.isPending ? "Announcing…" : "Announce"}
            </TabletButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <TabletLabel>Patient name</TabletLabel>
            <TabletInput
              value={form.patientName}
              onChange={(e) => setForm((f) => ({ ...f, patientName: e.target.value }))}
              placeholder="As told by the referee"
              autoFocus
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
          <div>
            <TabletLabel>Referee initials</TabletLabel>
            <TabletInput
              value={form.refereeInitials}
              onChange={(e) => setForm((f) => ({ ...f, refereeInitials: e.target.value }))}
              placeholder="e.g. RKS"
            />
          </div>
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
      </FlowScaffold>
    );
  }

  // ---- List ----
  return (
    <FlowScaffold
      heading="Incoming Referrals"
      subheading="Announced arrivals — link each one when the patient is registered"
      actions={
        <TabletButton className="w-full" onClick={() => setMode("announce")}>
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
          Nothing announced yet. When a referee sends a patient, announce them here first.
        </p>
      ) : (
        <div className="grid gap-2">
          {announcements.map((item) => (
            <TabletCard key={item.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold">{item.patient_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.coming_from ? `From ${item.coming_from} · ` : ""}
                    Referee {item.referee_initials} ·{" "}
                    {format(new Date(item.created_at), "dd MMM, HH:mm")}
                    {item.announced_by ? ` · by ${item.announced_by.split("@")[0]}` : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                    item.status === "LINKED"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800",
                  )}
                >
                  {item.status === "LINKED" ? "Linked" : "Awaited"}
                </span>
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
    </FlowScaffold>
  );
}
