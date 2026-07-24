import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The ward / room / bed board.
 *
 * `room_management` is the whole bed inventory: one row is either a ward or a
 * private room (is_private = true, with floor + room_number). `maximum_rooms` is
 * the bed count, so beds are 1..maximum_rooms.
 *
 * Occupancy is derived, never stored — a bed is occupied when an undischarged
 * visit carries ward_allotted = ward_id and room_allotted = the bed number. A bed
 * is booked when a live bed_bookings row points at it. Occupied wins over booked.
 */

export type BedStatus = "available" | "occupied" | "booked";

export interface BedOccupant {
  visitUuid: string;
  visitId: string | null;
  patientName: string;
  patientsId: string | null;
  corporate: string | null;
  patientType: string | null;
}

export interface BedBooking {
  id: string;
  patientName: string;
  patientsId: string | null;
  visitUuid: string | null;
  bookedFrom: string | null;
  bookedUntil: string | null;
  remark: string | null;
}

export interface Bed {
  /** `${wardId}#${bedNumber}` — the dnd-kit droppable id. */
  id: string;
  wardId: string;
  /** room_management.ward_type — what ward_shiftings.from_ward / shifting_ward store. */
  wardType: string;
  /** Ward group label this bed belongs to. */
  wardLabel: string;
  /** Room label within the group. */
  roomLabel: string;
  /** Private-room number, null for plain wards. */
  roomNumber: string | null;
  bedNumber: string;
  status: BedStatus;
  occupant?: BedOccupant;
  booking?: BedBooking;
}

export interface BoardRoom {
  wardId: string;
  label: string;
  /** True for Private Room Master rooms. */
  isPrivate: boolean;
  beds: Bed[];
}

export interface WardGroup {
  key: string;
  label: string;
  rooms: BoardRoom[];
  totalBeds: number;
  occupied: number;
}

export interface BedBoardData {
  groups: WardGroup[];
  /** Every bed, flat — for id lookups. */
  bedsById: Record<string, Bed>;
  totalBeds: number;
  totalOccupied: number;
  totalBooked: number;
}

interface RoomRow {
  id: string;
  ward_id: string;
  ward_type: string | null;
  maximum_rooms: number | null;
  is_private: boolean | null;
  floor: string | null;
  room_number: string | null;
  location: string | null;
}

const ADMITTED_TYPES = ["IPD", "IPD (Inpatient)", "Emergency"];

function wardGroupLabel(room: RoomRow): string {
  if (room.is_private) return room.floor?.trim() || "Private Rooms";
  return room.ward_type?.trim() || room.ward_id;
}

function roomLabel(room: RoomRow): string {
  if (room.is_private) {
    return room.room_number ? `Room ${room.room_number}` : room.ward_type || room.ward_id;
  }
  return room.ward_type?.trim() || room.ward_id;
}

/**
 * Live bed board for the active hospital.
 *
 * `extraWardId` pulls in a ward that is not registered under this hospital name
 * — some hope visits sit in ayushman-named wards, and the selected patient's
 * current bed must always be on the board.
 */
export function useBedBoard(extraWardId?: string | null) {
  const { hospitalConfig } = useAuth();

  return useQuery({
    queryKey: ["tablet-bed-board", hospitalConfig.name, extraWardId || null],
    staleTime: 1000 * 15,
    queryFn: async (): Promise<BedBoardData> => {
      const { data: hospitalRooms, error: rErr } = await supabase
        .from("room_management")
        .select(
          "id, ward_id, ward_type, maximum_rooms, is_private, floor, room_number, location",
        )
        .eq("hospital_name", hospitalConfig.name);
      if (rErr) throw rErr;

      let rooms = (hospitalRooms || []) as unknown as RoomRow[];

      if (extraWardId && !rooms.some((r) => r.ward_id === extraWardId)) {
        const { data: extra, error: eErr } = await supabase
          .from("room_management")
          .select(
            "id, ward_id, ward_type, maximum_rooms, is_private, floor, room_number, location",
          )
          .eq("ward_id", extraWardId)
          .limit(1);
        if (eErr) throw eErr;
        rooms = rooms.concat((extra || []) as unknown as RoomRow[]);
      }

      const wardIds = rooms.map((r) => r.ward_id).filter(Boolean);
      if (wardIds.length === 0) {
        return { groups: [], bedsById: {}, totalBeds: 0, totalOccupied: 0, totalBooked: 0 };
      }

      const [{ data: visits, error: vErr }, { data: bookings, error: bErr }] =
        await Promise.all([
          supabase
            .from("visits")
            .select(
              "id, visit_id, patient_type, ward_allotted, room_allotted, patients(name, patients_id, corporate)",
            )
            .in("ward_allotted", wardIds)
            .in("patient_type", ADMITTED_TYPES)
            .is("discharge_date", null),
          supabase
            .from("bed_bookings")
            .select(
              "id, ward_id, bed_number, visit_id, patient_name, patients_id, booked_from, booked_until, remark",
            )
            .in("ward_id", wardIds)
            .eq("status", "booked"),
        ]);
      if (vErr) throw vErr;
      // A missing bed_bookings table (migration not yet applied) must not blank
      // the whole board — beds simply render without the booked state.
      if (bErr) console.warn("bed_bookings unavailable:", bErr.message);

      const occupantByBed: Record<string, BedOccupant> = {};
      (visits || []).forEach((v: any) => {
        const bed = v.room_allotted ? String(v.room_allotted).trim() : "";
        if (!v.ward_allotted || !bed) return;
        occupantByBed[`${v.ward_allotted}#${bed}`] = {
          visitUuid: v.id,
          visitId: v.visit_id ?? null,
          patientName: v.patients?.name || "Unknown",
          patientsId: v.patients?.patients_id ?? null,
          corporate: v.patients?.corporate ?? null,
          patientType: v.patient_type ?? null,
        };
      });

      const bookingByBed: Record<string, BedBooking> = {};
      (bookings || []).forEach((b: any) => {
        bookingByBed[`${b.ward_id}#${String(b.bed_number).trim()}`] = {
          id: b.id,
          patientName: b.patient_name,
          patientsId: b.patients_id ?? null,
          visitUuid: b.visit_id ?? null,
          bookedFrom: b.booked_from ?? null,
          bookedUntil: b.booked_until ?? null,
          remark: b.remark ?? null,
        };
      });

      const bedsById: Record<string, Bed> = {};
      const groupMap = new Map<string, WardGroup>();

      rooms
        .slice()
        .sort((a, b) => wardGroupLabel(a).localeCompare(wardGroupLabel(b)))
        .forEach((room) => {
          const groupKey = wardGroupLabel(room);
          const rLabel = roomLabel(room);
          const bedCount = Math.max(0, Number(room.maximum_rooms) || 0);

          const beds: Bed[] = [];
          for (let i = 1; i <= bedCount; i++) {
            const bedNumber = String(i);
            const id = `${room.ward_id}#${bedNumber}`;
            const occupant = occupantByBed[id];
            const booking = bookingByBed[id];
            const bed: Bed = {
              id,
              wardId: room.ward_id,
              wardType: room.ward_type?.trim() || room.ward_id,
              wardLabel: groupKey,
              roomLabel: rLabel,
              roomNumber: room.room_number?.trim() || null,
              bedNumber,
              status: occupant ? "occupied" : booking ? "booked" : "available",
              occupant,
              booking,
            };
            beds.push(bed);
            bedsById[id] = bed;
          }

          // A patient parked on a bed number beyond the configured bed count
          // still has to appear, otherwise they vanish from the board.
          Object.entries(occupantByBed)
            .filter(([id]) => id.startsWith(`${room.ward_id}#`) && !bedsById[id])
            .forEach(([id, occupant]) => {
              const bed: Bed = {
                id,
                wardId: room.ward_id,
                wardType: room.ward_type?.trim() || room.ward_id,
                wardLabel: groupKey,
                roomLabel: rLabel,
                roomNumber: room.room_number?.trim() || null,
                bedNumber: id.split("#")[1],
                status: "occupied",
                occupant,
              };
              beds.push(bed);
              bedsById[id] = bed;
            });

          if (beds.length === 0) return;

          const group = groupMap.get(groupKey) || {
            key: groupKey,
            label: groupKey,
            rooms: [],
            totalBeds: 0,
            occupied: 0,
          };
          group.rooms.push({
            wardId: room.ward_id,
            label: rLabel,
            isPrivate: !!room.is_private,
            beds,
          });
          group.totalBeds += beds.length;
          group.occupied += beds.filter((b) => b.status === "occupied").length;
          groupMap.set(groupKey, group);
        });

      const groups = Array.from(groupMap.values()).map((g) => ({
        ...g,
        rooms: g.rooms.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
      }));

      const allBeds = Object.values(bedsById);
      return {
        groups,
        bedsById,
        totalBeds: allBeds.length,
        totalOccupied: allBeds.filter((b) => b.status === "occupied").length,
        totalBooked: allBeds.filter((b) => b.status === "booked").length,
      };
    },
  });
}
