import { supabase } from "@/integrations/supabase/client";
import type { SummarySignatory } from "./arshiyaSummaryPdf";

/**
 * The specialist who signs a patient's documents, with whatever credentials
 * the hospital has on file for them.
 *
 * Doctors are spread across hope_surgeons, hope_consultants, ayushman_surgeons
 * and doctors, none of which share an id, so credentials are matched by name -
 * the same way doctor_ledger_map matches surgeons to ledgers.
 *
 * Returns a signatory with no images when nothing is on file. The PDF then
 * prints a ruled space to be signed and stamped by hand, which is the honest
 * outcome: a document is only signed if somebody signed it.
 */
export async function loadSummarySignatory(
  doctorName: string | null | undefined,
): Promise<SummarySignatory | null> {
  const name = (doctorName || "").trim();
  if (!name) return null;

  // Matched on the normalised key, never the raw name. appointment_with is
  // typed by hand and its spacing varies - "Dr. Afzal Sheikh" and
  // "Dr. AFZAL  Sheikh" are 1,732 visits belonging to one doctor - so an exact
  // match would find a signature for some of a doctor's patients and not
  // others. name_key is the same expression, computed by the database.
  const nameKey = name.toLowerCase().replace(/\s+/g, " ");

  const { data, error } = await (supabase as any)
    .from("doctor_credentials")
    .select("doctor_name, qualification, registration_no, specialty, signature_url, stamp_url")
    .eq("name_key", nameKey)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    // Credentials are decoration on an otherwise complete document. Losing
    // them must not cost the user their PDF.
    console.warn("Could not load doctor credentials:", error.message);
    return { name };
  }

  if (!data) return { name };

  return {
    name: data.doctor_name || name,
    qualification: data.qualification || data.specialty || null,
    registrationNo: data.registration_no || null,
    signatureUrl: data.signature_url || null,
    stampUrl: data.stamp_url || null,
  };
}
