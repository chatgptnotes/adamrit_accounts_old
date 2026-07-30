/**
 * Which billing staffer owns a planned discharge.
 *
 * Discharges are worked in two shifts: Arshia from 9 a.m. to 4 p.m., Azar from
 * 4 p.m. to 9 p.m. The name is resolved once, when the discharge is ticked, and
 * stored on the visit — so a patient planned at 3 p.m. stays Arshia's even after
 * the clock rolls past 4.
 */

export const DISCHARGE_SHIFTS = [
  { name: "Arshia", startHour: 9, endHour: 16 },
  { name: "Azar", startHour: 16, endHour: 21 },
] as const;

export type DischargeStaffName = (typeof DISCHARGE_SHIFTS)[number]["name"];

/** The 4 p.m. handover. Ticks before it are Arshia's, at or after it are Azar's. */
const HANDOVER_HOUR = 16;

/**
 * Staffer responsible for a discharge planned at `at`. Ticks outside the 9-to-9
 * window still get an owner — an early-morning tick falls to Arshia and a late
 * one to Azar — because an unowned discharge is worse than an approximate one.
 */
export function resolveDischargeStaff(at: Date): DischargeStaffName {
  return at.getHours() < HANDOVER_HOUR ? "Arshia" : "Azar";
}
