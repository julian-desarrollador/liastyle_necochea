import type { Db, ObjectId } from "mongodb";
import { ObjectId as ObjectIdCtor } from "mongodb";

import { buildCapGetterForDate } from "@/lib/booking/agenda-blocks";
import { getAvailableTimesForDate, filterSlotsServiceEndsOnOrBeforeClose } from "@/lib/booking/salon-availability";
import { getPublicBookableTimeSlots } from "@/lib/booking/public-slot-lead";
import { KERATINA_ONLY_TIME_LOCAL, filterPublicSlotsByTreatmentRules } from "@/lib/booking/treatment-slot-rules";
import {
  filterSlotsBySalonCapacity,
  intervalHasZeroEffectiveCap,
  loadBusyIntervalsMs,
  slotIntervalMs,
  slotsExceedingSalonCapacity,
} from "@/lib/booking/slot-overlap";
import { findSalonTreatmentById } from "@/lib/treatments/catalog";

export type BookingSlotScope = "public" | "panel";

export type BookableSlotsResult = {
  slots: string[];
  overCapacitySlots: string[];
};

type ComputeSlotsParams = {
  dateKey: string;
  now: Date;
  scope: BookingSlotScope;
  excludeReservationHexId?: string | null;
  /**
   * Panel: no oculta horarios sin cupo (sobreturno).
   * La web pública nunca debe pasar `true`.
   */
  allowOverCapacity?: boolean;
};

function parseExcludeId(hex?: string | null): ObjectId | undefined {
  const ex = hex?.trim();
  if (!ex || !/^[a-f0-9]{24}$/i.test(ex)) return undefined;
  try {
    return new ObjectIdCtor(ex);
  } catch {
    return undefined;
  }
}

function applyCapacityFilter(
  candidates: string[],
  dateKey: string,
  durationMinutes: number,
  busy: Awaited<ReturnType<typeof loadBusyIntervalsMs>>,
  capGetter: (instantMs: number) => number,
  allowOverCapacity: boolean,
): BookableSlotsResult {
  if (allowOverCapacity) {
    const slots = candidates.filter((timeLocal) => {
      const slot = slotIntervalMs(dateKey, timeLocal, durationMinutes);
      if (!slot) return false;
      return !intervalHasZeroEffectiveCap(dateKey, slot, capGetter);
    });
    const overCapacitySlots = slotsExceedingSalonCapacity(
      slots,
      dateKey,
      durationMinutes,
      busy,
      capGetter,
    );
    return { slots, overCapacitySlots };
  }
  return {
    slots: filterSlotsBySalonCapacity(candidates, dateKey, durationMinutes, busy, capGetter),
    overCapacitySlots: [],
  };
}

/**
 * Horarios elegibles para un día y tratamiento (plantilla + reglas de servicio + solapes con DB).
 */
export async function computeBookableSlotsDetailed(
  db: Db,
  params: ComputeSlotsParams & { treatmentId: string },
): Promise<BookableSlotsResult> {
  const treatment = findSalonTreatmentById(params.treatmentId.trim());
  if (!treatment) return { slots: [], overCapacitySlots: [] };

  const excludeId = parseExcludeId(params.excludeReservationHexId);
  const allowOverCapacity = params.allowOverCapacity === true && params.scope === "panel";

  let slots =
    params.scope === "public"
      ? getPublicBookableTimeSlots(params.dateKey, params.now)
      : getAvailableTimesForDate(params.dateKey);

  slots = filterSlotsServiceEndsOnOrBeforeClose(slots, treatment.durationMinutes, params.dateKey);
  slots = filterPublicSlotsByTreatmentRules(treatment.id, slots, params.dateKey);
  const busy = await loadBusyIntervalsMs(db, params.dateKey, excludeId);
  const capGetter = await buildCapGetterForDate(db, params.dateKey);
  return applyCapacityFilter(
    slots,
    params.dateKey,
    treatment.durationMinutes,
    busy,
    capGetter,
    allowOverCapacity,
  );
}

export async function computeBookableSlots(
  db: Db,
  params: ComputeSlotsParams & { treatmentId: string },
): Promise<string[]> {
  const result = await computeBookableSlotsDetailed(db, params);
  return result.slots;
}

/**
 * Horarios elegibles para combo de servicios (duración total y reglas por servicio).
 */
export async function computeBookableSlotsForTreatmentIdsDetailed(
  db: Db,
  params: ComputeSlotsParams & { treatmentIds: string[] },
): Promise<BookableSlotsResult> {
  function pad2(n: number) {
    return String(n).padStart(2, "0");
  }
  function hhmmToMinutes(hhmm: string) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  const ids = params.treatmentIds.map((v) => v.trim()).filter(Boolean);
  if (ids.length === 0) return { slots: [], overCapacitySlots: [] };
  const treatments = ids
    .map((id) => findSalonTreatmentById(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  if (treatments.length !== ids.length) return { slots: [], overCapacitySlots: [] };
  const totalDuration = treatments.reduce((acc, t) => acc + t.durationMinutes, 0);

  const excludeId = parseExcludeId(params.excludeReservationHexId);
  const allowOverCapacity = params.allowOverCapacity === true && params.scope === "panel";

  let slots =
    params.scope === "public"
      ? getPublicBookableTimeSlots(params.dateKey, params.now)
      : getAvailableTimesForDate(params.dateKey);
  slots = filterSlotsServiceEndsOnOrBeforeClose(slots, totalDuration, params.dateKey);
  const keratinaIdx = treatments.findIndex((t) => t.id === "keratina");
  if (params.scope === "public" && keratinaIdx >= 0) {
    // En combos públicos, keratina debe quedar al final y empezar a las 15:00.
    if (keratinaIdx !== treatments.length - 1) return { slots: [], overCapacitySlots: [] };
    const beforeDuration = treatments.slice(0, keratinaIdx).reduce((acc, t) => acc + t.durationMinutes, 0);
    const [h, m] = KERATINA_ONLY_TIME_LOCAL.split(":").map(Number);
    const startMins = h * 60 + m - beforeDuration;
    if (startMins < 0 || startMins >= 24 * 60) return { slots: [], overCapacitySlots: [] };
    const startAt = `${pad2(Math.floor(startMins / 60))}:${pad2(startMins % 60)}`;
    if (slots.length === 0) return { slots: [], overCapacitySlots: [] };
    const dayOpenMins = hhmmToMinutes(slots[0]);
    if (startMins < dayOpenMins) return { slots: [], overCapacitySlots: [] };
    slots = [startAt];
    for (const t of treatments) {
      if (t.id === "keratina") continue;
      slots = filterPublicSlotsByTreatmentRules(t.id, slots, params.dateKey);
    }
  } else {
    for (const t of treatments) {
      slots = filterPublicSlotsByTreatmentRules(t.id, slots, params.dateKey);
    }
  }
  const busy = await loadBusyIntervalsMs(db, params.dateKey, excludeId);
  const capGetter = await buildCapGetterForDate(db, params.dateKey);
  return applyCapacityFilter(slots, params.dateKey, totalDuration, busy, capGetter, allowOverCapacity);
}

export async function computeBookableSlotsForTreatmentIds(
  db: Db,
  params: ComputeSlotsParams & { treatmentIds: string[] },
): Promise<string[]> {
  const result = await computeBookableSlotsForTreatmentIdsDetailed(db, params);
  return result.slots;
}
