import { supabase } from "@/integrations/supabase/client";
import { deriveQuantity } from "@/lib/ward-bridge-logic";

// Some bridge columns (source, visit_id, visit_medication_id) and several
// visit_medications columns are absent from the stale generated types.
const db = supabase as any;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bridge an APPROVED tablet medicine (visit_medications) into the desktop
 * pharmacy by creating/append­ing a normal `prescriptions` + `prescription_items`
 * record (status APPROVED, source 'ward'). One open ward prescription per visit
 * PER DAY — a re-send on a new day starts a fresh pharmacy card; same-day re-sends
 * append to today's card and re-float it (bumping `updated_at` so the bell rings).
 * Items are deduped by the unique index on `visit_medication_id`, so re-approving
 * the same med is a no-op. Resolves the patient via `visits.patient_id` (= patients.id, the
 * same key the whole desktop uses). Best-effort: never throws — approval must not
 * fail because the bridge had a problem.
 */
export interface BridgeResult {
  ok: boolean;
  reason?: string;
}

export async function bridgeApprovedMedicationToPharmacy(
  visitMedicationId: string,
  patientLocation?: string | null,
): Promise<BridgeResult> {
  try {
    // 1. Load the source row; only bridge an approved, not-yet-dispensed med.
    const { data: vm } = await db
      .from("visit_medications")
      .select(
        "id, visit_id, medication_id, custom_medication_name, dispensed_medication_name, dosage, frequency, duration, route, status, is_approved, notes",
      )
      .eq("id", visitMedicationId)
      .maybeSingle();
    if (!vm || !vm.is_approved || vm.status === "dispensed") {
      return { ok: false, reason: "medication not approved or already dispensed" };
    }

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
    if (!v) return { ok: false, reason: "no visit linked to this medication" };
    const visitQuery = db
      .from("visits")
      .select("id, patient_id, appointment_with, patients(hospital_name)")
      .limit(1);
    const { data: visit } = await (
      UUID_RE.test(v) ? visitQuery.eq("id", v) : visitQuery.eq("visit_id", v)
    ).maybeSingle();
    // can't bridge without a patient
    if (!visit || !visit.patient_id) {
      return { ok: false, reason: "could not resolve the patient for this visit" };
    }

    const visitUuid = visit.id;
    const patientId = visit.patient_id;
    const doctorName = visit.appointment_with || "Ward";
    // Stamp the patient's hospital so each hospital's pharmacist sees only
    // their own ward orders (Hope and Ayushman run separate pharmacies).
    // Normalize to lowercase so a 'Hope'/'hope' casing mismatch can't silently
    // hide the order from the pharmacy bell; a genuinely-missing value stays
    // null (the bell shows null-hospital ward orders to everyone).
    const hospitalName =
      (visit.patients?.hospital_name || "").trim().toLowerCase() || null;

    // 4. Find-or-create the OPEN ward prescription for this visit *for today*.
    //    Scoping the reuse to today's date gives each day its own pharmacy card,
    //    so a re-send on a new day always surfaces as a new prescription + alert.
    const today = new Date().toISOString().slice(0, 10);
    let prescriptionId: string | undefined;
    let reusedExisting = false;
    const { data: openRx } = await db
      .from("prescriptions")
      .select("id")
      .eq("visit_id", visitUuid)
      .eq("source", "ward")
      .eq("prescription_date", today)
      .in("status", ["APPROVED", "PARTIALLY_DISPENSED"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openRx?.id) {
      prescriptionId = openRx.id;
      reusedExisting = true;
    } else {
      const { data: newRx, error: rxErr } = await db
        .from("prescriptions")
        .insert({
          prescription_number: "RX-" + Date.now(),
          patient_id: patientId,
          visit_id: visitUuid,
          doctor_name: doctorName,
          prescription_date: today,
          status: "APPROVED", // doctor already approved on the tablet
          source: "ward",
          hospital_name: hospitalName,
          notes: "Ward order — auto-bridged from Treatment Sheet",
          ...(patientLocation ? { patient_location: patientLocation } : {}),
        })
        .select("id")
        .single();
      if (rxErr || !newRx) {
        // A concurrent approval for the same visit/day can win the race and
        // trip the (visit_id, prescription_date) WHERE source='ward' unique
        // index. Recover by reusing the card the other approval just created
        // instead of failing — both meds belong on the same daily card.
        const isDuplicateCard =
          !!rxErr &&
          (rxErr.code === "23505" ||
            /duplicate key/i.test(rxErr.message || ""));
        if (isDuplicateCard) {
          const { data: raced } = await db
            .from("prescriptions")
            .select("id")
            .eq("visit_id", visitUuid)
            .eq("source", "ward")
            .eq("prescription_date", today)
            .in("status", ["APPROVED", "PARTIALLY_DISPENSED"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (raced?.id) {
            prescriptionId = raced.id;
            reusedExisting = true;
          }
        }
        if (!prescriptionId) {
          return { ok: false, reason: "could not create the pharmacy order" };
        }
      } else {
        prescriptionId = newRx.id;
      }
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
    const isDuplicate =
      !!itemErr &&
      (itemErr.code === "23505" || /duplicate key/i.test(itemErr.message || ""));
    if (itemErr && !isDuplicate) {
      console.warn("ward-bridge: item insert failed:", itemErr.message);
      return { ok: false, reason: "could not add the medicine to the pharmacy order" };
    }

    // 6. A same-day re-send appends to an existing card, so no new `prescriptions`
    //    row fires for the notification bell. When a genuinely new item was added,
    //    bump the card so it re-floats and emits a realtime UPDATE the bell hears.
    //    Also update patient_location if provided (doctor may have changed it).
    if (reusedExisting && !itemErr) {
      await db
        .from("prescriptions")
        .update({
          prescription_date: today,
          updated_at: new Date().toISOString(),
          ...(patientLocation ? { patient_location: patientLocation } : {}),
        })
        .eq("id", prescriptionId);
    }

    // Reaching here means the order exists in the pharmacy queue (a duplicate
    // item just means it was already bridged — still a success for the user).
    return { ok: true };
  } catch (e) {
    console.warn("ward-bridge: skipped:", (e as Error)?.message);
    return { ok: false, reason: (e as Error)?.message || "unexpected error" };
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
