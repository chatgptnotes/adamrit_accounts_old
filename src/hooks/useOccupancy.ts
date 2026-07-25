import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface OccupantRef {
  visitId: string;
  name: string;
  room: string | null;
  patientType: string | null;
}

export interface WardOccupancy {
  id: string;
  wardType: string;
  wardId: string | null;
  location: string | null;
  capacity: number;
  occupied: number;
  occupants: OccupantRef[];
}

export interface OccupancySnapshot {
  wards: WardOccupancy[];
  totalCapacity: number;
  totalOccupied: number;
  unassigned: number;
}

/**
 * Live bed occupancy: room_management wards cross-referenced with currently
 * admitted IPD visits. Hospital-scoped and read-only. Defaults to the logged-in
 * hospital; pass `hospitalOverride` to read another (the director view shows
 * both Hope and Ayushman).
 */
export function useOccupancy(hospitalOverride?: string) {
  const { hospitalConfig } = useAuth();
  const hospital = hospitalOverride ?? hospitalConfig.name;
  return useQuery({
    queryKey: ["tablet-occupancy", hospital],
    staleTime: 1000 * 30,
    queryFn: async (): Promise<OccupancySnapshot> => {
      const { data: rooms, error: rErr } = await supabase
        .from("room_management")
        .select("id, ward_type, ward_id, location, maximum_rooms, hospital_name")
        .eq("hospital_name", hospital);
      if (rErr) throw rErr;

      const { data: visits, error: vErr } = await supabase
        .from("visits")
        .select(
          "visit_id, patient_type, ward_allotted, room_allotted, patients!inner(name, hospital_name)",
        )
        .in("patient_type", ["IPD", "IPD (Inpatient)", "Emergency"])
        .is("discharge_date", null)
        .eq("patients.hospital_name", hospital);
      if (vErr) throw vErr;

      const admitted = (visits || []).map((v: any) => ({
        visitId: v.visit_id as string,
        name: (v.patients?.name as string) || "Unknown",
        room: (v.room_allotted as string) || null,
        ward: (v.ward_allotted as string) || "",
        patientType: (v.patient_type as string) ?? null,
      }));

      const matched = new Set<string>();
      const wards: WardOccupancy[] = (rooms || []).map((r: any) => {
        const occupants = admitted.filter(
          (a) => a.ward && (a.ward === r.ward_id || a.ward === r.ward_type),
        );
        occupants.forEach((o) => matched.add(o.visitId));
        return {
          id: r.id,
          wardType: r.ward_type || "Ward",
          wardId: r.ward_id || null,
          location: r.location || null,
          capacity: Number(r.maximum_rooms) || 0,
          occupied: occupants.length,
          occupants: occupants.map((o) => ({
            visitId: o.visitId,
            name: o.name,
            room: o.room,
            patientType: o.patientType,
          })),
        };
      });

      return {
        wards,
        totalCapacity: wards.reduce((s, w) => s + w.capacity, 0),
        totalOccupied: admitted.length,
        unassigned: admitted.filter((a) => !matched.has(a.visitId)).length,
      };
    },
  });
}
