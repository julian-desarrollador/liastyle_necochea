import type { Db, ObjectId } from "mongodb";
import { ObjectId as ObjectIdCtor } from "mongodb";

import {
  buildCapGetterForDate,
  buildCapGetterFromAgendaBlocks,
  listAgendaBlocksForDateKeyRange,
} from "@/lib/booking/agenda-blocks";
import { getAvailableTimesForDate, filterSlotsServiceEndsOnOrBeforeClose } from "@/lib/booking/salon-availability";
import { getPublicBookableTimeSlots } from "@/lib/booking/public-slot-lead";
import { KERATINA_ONLY_TIME_LOCAL, filterPublicSlotsByTreatmentRules } from "@/lib/booking/treatment-slot-rules";
import {
  canPlaceReservationSlot,
  filterSlotsBySalonCapacity,
  intervalHasZeroEffectiveCap,
  loadBusyIntervalsByDateKey,
  loadBusyIntervalsMs,
  slotIntervalMs,
  slotsExceedingSalonCapacity,
  type IntervalMs,
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function gridTimesForDate(dateKey: string, now: Date, scope: BookingSlotScope): string[] {
  return scope === "public" ? getPublicBookableTimeSlots(dateKey, now) : getAvailableTimesForDate(dateKey);
}

function candidateTimesForTreatment(
  dateKey: string,
  treatmentId: string,
  durationMinutes: number,
  now: Date,
  scope: BookingSlotScope,
): string[] {
  let slots = gridTimesForDate(dateKey, now, scope);
  slots = filterSlotsServiceEndsOnOrBeforeClose(slots, durationMinutes, dateKey);
  return filterPublicSlotsByTreatmentRules(treatmentId, slots, dateKey);
}

function candidateTimesForTreatments(
  dateKey: string,
  treatments: { id: string; durationMinutes: number }[],
  now: Date,
  scope: BookingSlotScope,
): string[] {
  const totalDuration = treatments.reduce((acc, t) => acc + t.durationMinutes, 0);
  let slots = gridTimesForDate(dateKey, now, scope);
  slots = filterSlotsServiceEndsOnOrBeforeClose(slots, totalDuration, dateKey);
  const keratinaIdx = treatments.findIndex((t) => t.id === "keratina");
  if (scope === "public" && keratinaIdx >= 0) {
    if (keratinaIdx !== treatments.length - 1) return [];
    const beforeDuration = treatments.slice(0, keratinaIdx).reduce((acc, t) => acc + t.durationMinutes, 0);
    const [h, m] = KERATINA_ONLY_TIME_LOCAL.split(":").map(Number);
    const startMins = h * 60 + m - beforeDuration;
    if (startMins < 0 || startMins >= 24 * 60) return [];
    const startAt = `${pad2(Math.floor(startMins / 60))}:${pad2(startMins % 60)}`;
    if (slots.length === 0) return [];
    const dayOpenMins = hhmmToMinutes(slots[0]);
    if (startMins < dayOpenMins) return [];
    slots = [startAt];
    for (const t of treatments) {
      if (t.id === "keratina") continue;
      slots = filterPublicSlotsByTreatmentRules(t.id, slots, dateKey);
    }
    return slots;
  }
  for (const t of treatments) {
    slots = filterPublicSlotsByTreatmentRules(t.id, slots, dateKey);
  }
  return slots;
}

function applyCapacityFilter(
  candidates: string[],
  dateKey: string,
  durationMinutes: number,
  busy: IntervalMs[],
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

function dayHasBookableSlot(
  dateKey: string,
  candidates: string[],
  durationMinutes: number,
  busy: IntervalMs[],
  capGetter: (instantMs: number) => number,
  allowOverCapacity: boolean,
): boolean {
  if (candidates.length === 0) return false;
  if (allowOverCapacity) {
    return candidates.some((timeLocal) => {
      const slot = slotIntervalMs(dateKey, timeLocal, durationMinutes);
      return Boolean(slot && !intervalHasZeroEffectiveCap(dateKey, slot, capGetter));
    });
  }
  return candidates.some((timeLocal) => {
    const slot = slotIntervalMs(dateKey, timeLocal, durationMinutes);
    return Boolean(slot && canPlaceReservationSlot(dateKey, slot, busy, capGetter));
  });
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
  const slots = candidateTimesForTreatment(
    params.dateKey,
    treatment.id,
    treatment.durationMinutes,
    params.now,
    params.scope,
  );
  if (slots.length === 0) return { slots: [], overCapacitySlots: [] };

  const [busy, capGetter] = await Promise.all([
    loadBusyIntervalsMs(db, params.dateKey, excludeId),
    buildCapGetterForDate(db, params.dateKey),
  ]);
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
  const ids = params.treatmentIds.map((v) => v.trim()).filter(Boolean);
  if (ids.length === 0) return { slots: [], overCapacitySlots: [] };
  const treatments = ids
    .map((id) => findSalonTreatmentById(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
  if (treatments.length !== ids.length) return { slots: [], overCapacitySlots: [] };
  const totalDuration = treatments.reduce((acc, t) => acc + t.durationMinutes, 0);

  const excludeId = parseExcludeId(params.excludeReservationHexId);
  const allowOverCapacity = params.allowOverCapacity === true && params.scope === "panel";
  const slots = candidateTimesForTreatments(params.dateKey, treatments, params.now, params.scope);
  if (slots.length === 0) return { slots: [], overCapacitySlots: [] };

  const [busy, capGetter] = await Promise.all([
    loadBusyIntervalsMs(db, params.dateKey, excludeId),
    buildCapGetterForDate(db, params.dateKey),
  ]);
  return applyCapacityFilter(slots, params.dateKey, totalDuration, busy, capGetter, allowOverCapacity);
}

export async function computeBookableSlotsForTreatmentIds(
  db: Db,
  params: ComputeSlotsParams & { treatmentIds: string[] },
): Promise<string[]> {
  const result = await computeBookableSlotsForTreatmentIdsDetailed(db, params);
  return result.slots;
}

type MonthAvailabilityParams = {
  dateKeys: string[];
  now: Date;
  scope: BookingSlotScope;
  treatmentId?: string;
  treatmentIds?: string[];
  allowOverCapacity?: boolean;
};

/**
 * Qué días del grid tienen al menos un horario bookable.
 * Una lectura de reservas + una de bloqueos para todo el rango (no N queries por día).
 */
export async function computeMonthBookableFlags(
  db: Db,
  params: MonthAvailabilityParams,
): Promise<Record<string, boolean>> {
  const dateKeys = params.dateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
  const flags: Record<string, boolean> = {};
  if (dateKeys.length === 0) return flags;

  const allowOverCapacity = params.allowOverCapacity === true && params.scope === "panel";
  const comboIds = (params.treatmentIds ?? []).map((v) => v.trim()).filter(Boolean);

  let comboTreatments: { id: string; durationMinutes: number }[] | null = null;
  if (comboIds.length > 0) {
    comboTreatments = [];
    for (const id of comboIds) {
      const t = findSalonTreatmentById(id);
      if (!t) {
        for (const key of dateKeys) flags[key] = false;
        return flags;
      }
      comboTreatments.push({ id: t.id, durationMinutes: t.durationMinutes });
    }
  }
  const single = comboTreatments ? null : findSalonTreatmentById((params.treatmentId ?? "").trim());
  if (!comboTreatments && !single) {
    for (const key of dateKeys) flags[key] = false;
    return flags;
  }

  const durationMinutes = comboTreatments
    ? comboTreatments.reduce((acc, t) => acc + t.durationMinutes, 0)
    : single!.durationMinutes;

  const sortedKeys = [...dateKeys].sort();
  const from = sortedKeys[0];
  const to = sortedKeys[sortedKeys.length - 1];

  const [busyByDay, blocks] = await Promise.all([
    loadBusyIntervalsByDateKey(db, dateKeys),
    listAgendaBlocksForDateKeyRange(db, from, to),
  ]);

  const capByDay = new Map<string, (instantMs: number) => number>();
  function capFor(dateKey: string) {
    let getter = capByDay.get(dateKey);
    if (!getter) {
      getter = buildCapGetterFromAgendaBlocks(dateKey, blocks);
      capByDay.set(dateKey, getter);
    }
    return getter;
  }

  for (const dateKey of dateKeys) {
    const candidates = comboTreatments
      ? candidateTimesForTreatments(dateKey, comboTreatments, params.now, params.scope)
      : candidateTimesForTreatment(dateKey, single!.id, single!.durationMinutes, params.now, params.scope);
    flags[dateKey] = dayHasBookableSlot(
      dateKey,
      candidates,
      durationMinutes,
      busyByDay.get(dateKey) ?? [],
      capFor(dateKey),
      allowOverCapacity,
    );
  }

  return flags;
}
