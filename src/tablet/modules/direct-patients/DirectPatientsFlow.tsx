import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ShieldCheck, ShieldOff, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletPatientPicker } from "@/tablet/components/TabletPatientPicker";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";

// DATA SOURCE: patients.is_direct — database triggers block any referee on a
// direct patient, on every screen, including registration.

export default function DirectPatientsFlow() {
  const { user, hospitalType } = useAuth();
  const queryClient = useQueryClient();
  const [searchHospital, setSearchHospital] = useState<"hope" | "ayushman">(
    hospitalType === "ayushman" ? "ayushman" : "hope",
  );
  const [picking, setPicking] = useState(false);

  const { data: directPatients = [] } = useQuery({
    queryKey: ["direct-patients"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("patients")
        .select("id, name, patients_id, hospital_name, direct_marked_by, direct_marked_at")
        .eq("is_direct", true)
        .order("direct_marked_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const setDirect = useMutation({
    mutationFn: async ({ id, direct }: { id: string; direct: boolean }) => {
      const { error } = await (supabase as any)
        .from("patients")
        .update({
          is_direct: direct,
          direct_marked_by: direct ? user?.email || user?.id || null : null,
          direct_marked_at: direct ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, { direct }) => {
      toast.success(direct ? "Marked DIRECT — referees are now blocked for this patient." : "Direct mark removed.");
      setPicking(false);
      queryClient.invalidateQueries({ queryKey: ["direct-patients"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  if (picking) {
    return (
      <FlowScaffold
        heading="Mark a patient DIRECT"
        subheading="Find the patient — the database then refuses any referee on them"
        actions={
          <TabletButton variant="outline" className="w-full" onClick={() => setPicking(false)}>
            Back
          </TabletButton>
        }
      >
        <TabletPatientPicker
          heading="Which patient?"
          hint="Search by name, patient ID or mobile number"
          hospital={searchHospital}
          onHospitalChange={setSearchHospital}
          onSelect={(patient: Patient) => setDirect.mutate({ id: patient.id, direct: true })}
        />
      </FlowScaffold>
    );
  }

  return (
    <FlowScaffold
      heading="Direct Patients"
      subheading="Direct means: no referee, no cut — enforced by the database itself"
      actions={
        <TabletButton className="w-full" onClick={() => setPicking(true)}>
          <UserCheck className="mr-2 h-5 w-5" /> Mark a patient DIRECT
        </TabletButton>
      }
    >
      {directPatients.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">No patients marked direct yet.</p>
      ) : (
        <div className="grid gap-2">
          {directPatients.map((p: any) => (
            <TabletCard key={p.id} className="flex items-center justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 truncate text-base font-semibold">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" /> {p.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.patients_id || ""} · {p.hospital_name || ""}
                  {p.direct_marked_by ? ` · by ${String(p.direct_marked_by).split("@")[0]}` : ""}
                  {p.direct_marked_at ? ` · ${format(new Date(p.direct_marked_at), "dd MMM")}` : ""}
                </span>
              </span>
              <TabletButton
                variant="outline"
                size="default"
                className="min-h-[40px] shrink-0 text-xs"
                disabled={setDirect.isPending}
                onClick={() => setDirect.mutate({ id: p.id, direct: false })}
              >
                <ShieldOff className="mr-1 h-4 w-4" /> Remove
              </TabletButton>
            </TabletCard>
          ))}
        </div>
      )}
    </FlowScaffold>
  );
}
