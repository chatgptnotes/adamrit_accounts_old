import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TabletPatient {
  id: string; // patients.id (UUID)
  patientsId: string | null; // patients.patients_id (text)
  name: string;
  age: number | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bloodGroup: string | null;
  dateOfBirth: string | null;
  city: string | null;
  state: string | null;
  registeredAt: string | null;
  /** patients.corporate — the panel, used to resolve mandatory documents. */
  corporate: string | null;
  aadhaarNumber: string | null;
}

function mapPatient(p: any): TabletPatient {
  return {
    id: p.id,
    patientsId: p.patients_id ?? null,
    name: p.name ?? "Unknown",
    age: p.age ?? null,
    gender: p.gender ?? null,
    phone: p.phone ?? null,
    email: p.email ?? null,
    address: p.address ?? null,
    bloodGroup: p.blood_group ?? null,
    dateOfBirth: p.date_of_birth ?? null,
    city: p.city_town ?? null,
    state: p.state ?? null,
    registeredAt: p.created_at ?? null,
    corporate: p.corporate ?? null,
    aadhaarNumber: p.aadhaar_number ?? null,
  };
}

const SELECT =
  "id, patients_id, name, age, gender, phone, email, address, blood_group, date_of_birth, city_town, state, created_at, corporate, aadhaar_number";

/**
 * Every patient registered under the active hospital — old and new, all visit
 * types. Pass a search term to filter server-side by name, patient ID or phone;
 * Results are ordered by registration date, newest first.
 */
export function usePatientSearch(term: string) {
  const { hospitalConfig } = useAuth();
  const t = term.trim();
  return useQuery({
    queryKey: ["tablet-patient-search", hospitalConfig.name, t],
    staleTime: 1000 * 30,
    queryFn: async (): Promise<TabletPatient[]> => {
      let q = supabase
        .from("patients")
        .select(SELECT)
        .eq("hospital_name", hospitalConfig.name)
        .order("created_at", { ascending: false })
        .limit(100);
      if (t) {
        // Escape %/, so they aren't treated as ilike wildcards / or-separators.
        const safe = t.replace(/[%,]/g, "");
        const clauses = [
          `name.ilike.%${safe}%`,
          `patients_id.ilike.%${safe}%`,
          `phone.ilike.%${safe}%`,
        ];
        // Aadhaar is stored as bare digits but read off a card printed in
        // groups of four, so match on the digits alone — someone typing
        // "1234 5678 9012" means the same number. Four digits is the floor:
        // shorter than that and every patient matches on the last block.
        const digits = t.replace(/\D/g, "");
        if (digits.length >= 4) clauses.push(`aadhaar_number.ilike.%${digits}%`);
        q = q.or(clauses.join(","));
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(mapPatient);
    },
  });
}
