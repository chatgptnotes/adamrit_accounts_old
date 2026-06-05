import { supabase } from "@/integrations/supabase/client";

// Some bridge columns (source, visit_id, visit_medication_id) and several
// visit_medications columns are absent from the stale generated types.
const db = supabase as any;

/** Doses-per-day for the common frequency codes; anything else falls back to 1. */
const FREQ_PER_DAY: Record<string, number> = {
  OD: 1, HS: 1, SOS: 1, STAT: 1,
  BD: 2, BID: 2, Q12H: 2,
  TDS: 3, TID: 3, Q8H: 3,
  QID: 4, QDS: 4, Q6H: 4,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Total units to prescribe ≈ doses/day × days. Always ≥ 1 (column is NOT NULL). */
function deriveQuantity(frequency?: string | null, duration?: string | null): number {
  const key = (frequency || "").trim().toUpperCase().split(/[\s/]/)[0];
  const perDay = FREQ_PER_DAY[key] || 1;
  const days = parseInt(String(duration ?? ""), 10);
  const d = Number.isFinite(days) && days > 0 ? days : 1;
  return Math.max(1, perDay * d);
}

/**
 * Bridge an APPROVED tablet medicine (visit_medications) into the desktop
 * pharmacy by creating/append­ing a normal `prescriptions` + `prescription_items`
 * record (status APPROVED, source 'ward'). One open ward prescription per visit;
 * items are deduped by the unique index on `visit_medication_id`, so re-approving
 * is a no-op. Resolves the patient via `visits.patient_id` (= patients.id, the
 * same key the whole desktop uses). Best-effort: never throws — approval must not
 * fail because the bridge had a problem.
 */
export async function bridgeApprovedMedicationToPharmacy(
  visitMedicationId: string,
): Promise<void> {
  try {
    // 1. Load the source row; only bridge an approved, not-yet-dispensed med.
    const { data: vm } = await db
      .from("visit_medications")
      .select(
        "id, visit_id, medication_id, custom_medication_name, dispensed_medication_name, dosage, frequency, duration, route, status, is_approved, notes",
      )
      .eq("id", visitMedicationId)
      .maybeSingle();
    if (!vm || !vm.is_approved || vm.status === "dispensed") return;

    // 2. Resolve the medicine name (the doctor typed it; pharmacy may substitute).
    let name: string =
      vm.dispensed_medication_name || vm.custom_medication_name || "";
    if (!name && vm.medication_id) {
      const { data: mm } = await db
        .from("medicine_master")
        .select("medicine_name, generic_name")
        .eq("id", vm.medication_id)
        .maybeSingle();
      name = mm?.medicine_name || mm?.generic_name || "";
    }
    if (!name) name = "Medication";

    // 3. Resolve visit -> patient -> doctor. visit_id may hold the UUID or the
    //    text visit code, so query the right column (avoids a uuid parse error).
    const v = String(vm.visit_id || "");
    if (!v) return;
    const visitQuery = db
      .from("visits")
      .select("id, patient_id, appointment_with, patients(hospital_name)")
      .limit(1);
    const { data: visit } = await (
      UUID_RE.test(v) ? visitQuery.eq("id", v) : visitQuery.eq("visit_id", v)
    ).maybeSingle();
    if (!visit || !visit.patient_id) return; // can't bridge without a patient

    const visitUuid = visit.id;
    const patientId = visit.patient_id;
    const doctorName = visit.appointment_with || "Ward";
    // Stamp the patient's hospital so each hospital's pharmacist sees only
    // their own ward orders (Hope and Ayushman run separate pharmacies).
    const hospitalName = visit.patients?.hospital_name || null;

    // 4. Find-or-create the OPEN ward prescription for this visit.
    let prescriptionId: string | undefined;
    const { data: openRx } = await db
      .from("prescriptions")
      .select("id")
      .eq("visit_id", visitUuid)
      .eq("source", "ward")
      .in("status", ["APPROVED", "PARTIALLY_DISPENSED"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openRx?.id) {
      prescriptionId = openRx.id;
    } else {
      const { data: newRx, error: rxErr } = await db
        .from("prescriptions")
        .insert({
          prescription_number: "RX-" + Date.now(),
          patient_id: patientId,
          visit_id: visitUuid,
          doctor_name: doctorName,
          prescription_date: new Date().toISOString().slice(0, 10),
          status: "APPROVED", // doctor already approved on the tablet
          source: "ward",
          hospital_name: hospitalName,
          notes: "Ward order — auto-bridged from Treatment Sheet",
        })
        .select("id")
        .single();
      if (rxErr || !newRx) return;
      prescriptionId = newRx.id;
    }

    // 5. Append the item. The partial unique index on visit_medication_id makes
    //    a re-approve insert throw 23505 — which we treat as "already bridged".
    const { error: itemErr } = await db.from("prescription_items").insert({
      prescription_id: prescriptionId,
      visit_medication_id: vm.id,
      medicine_id: null,
      medicine_name: name,
      quantity_prescribed: deriveQuantity(vm.frequency, vm.duration),
      quantity_dispensed: 0,
      dosage_frequency: vm.frequency || null,
      dosage_timing: vm.route || null,
      duration_days: parseInt(String(vm.duration ?? ""), 10) || null,
      special_instructions:
        [vm.dosage, vm.notes].filter(Boolean).join(" · ") || null,
    });
    if (
      itemErr &&
      itemErr.code !== "23505" &&
      !/duplicate key/i.test(itemErr.message || "")
    ) {
      console.warn("ward-bridge: item insert failed:", itemErr.message);
    }
  } catch (e) {
    console.warn("ward-bridge: skipped:", (e as Error)?.message);
  }
}

/**
 * When a tablet med is stopped / changed-out / deleted *before* being dispensed,
 * remove its bridged prescription_item so it leaves the pharmacy queue. Only
 * touches not-yet-dispensed items (quantity_dispensed = 0); a partially/fully
 * dispensed item is left intact. If removing it empties the prescription, the
 * prescription is marked CANCELLED. Best-effort: never throws.
 */
export async function cancelBridgedItemIfPending(
  visitMedicationId: string,
): Promise<void> {
  try {
    const { data: item } = await db
      .from("prescription_items")
      .select("id, prescription_id, quantity_dispensed")
      .eq("visit_medication_id", visitMedicationId)
      .maybeSingle();
    if (!item || (item.quantity_dispensed || 0) > 0) return;

    await db.from("prescription_items").delete().eq("id", item.id);

    const { count } = await db
      .from("prescription_items")
      .select("id", { count: "exact", head: true })
      .eq("prescription_id", item.prescription_id);
    if ((count || 0) === 0) {
      await db
        .from("prescriptions")
        .update({ status: "CANCELLED" })
        .eq("id", item.prescription_id);
    }
  } catch (e) {
    console.warn("ward-bridge: cancel skipped:", (e as Error)?.message);
  }
}
