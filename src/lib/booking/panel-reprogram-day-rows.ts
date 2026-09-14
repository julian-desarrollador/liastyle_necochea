import type { Db, ObjectId } from "mongodb";
import { ObjectId as ObjectIdCtor } from "mongodb";

import type { BookingSlotScope } from "@/lib/booking/compute-bookable-slots";
import { computeBookableSlots } from "@/lib/booking/compute-bookable-slots";
import { intervalForAgendaBlockOnDate, listSalonAgendaBlocksApplyingToDateKey } from "@/lib/booking/agenda-blocks";
import { filterPublicSlotsByTreatmentRules } from "@/lib/booking/treatment-slot-rules";
import { filterSlotsServiceEndsOnOrBeforeClose, getAvailableTimesForDate } from "@/lib/booking/salon-availability";
import { getPublicBookableTimeSlots } from "@/lib/booking/public-slot-lead";
import {
  intervalsOverlap,
  reservationDurationMinutesFromDoc,
  slotIntervalMs,
  slotOccupancyMongoFilter,
  type IntervalMs,
} from "@/lib/booking/slot-overlap";
import { findSalonTreatmentById } from "@/lib/treatments/catalog";
import type { ReservationDoc } from "@/lib/reservations/types";

const COLLECTION = "reservations";

export type ReprogramDayRow =
  | { timeLocal: string; kind: "available" }
  | { timeLocal: string; kind: "reserved"; customerName: string; treatmentName: string }
  | { timeLocal: string; kind: "agenda_block"; scope: string; notes: string | null }
  | { timeLocal: string; kind: "capacity_full" };

/** @deprecated usar `ReprogramDayRow` */
export type PanelReprogramDayRow = ReprogramDayRow;

async function listActiveReservationsForDayDisplay(
  db: Db,
  dateKey: string,
  excludeReservationId?: ObjectId,
): Promise<ReservationDoc[]> {
  const filter: Record<string, unknown> = {
    dateKey,
    ...slotOccupancyMongoFilter("holding"),
  };
  if (excludeReservationId) {
    filter._id = { $ne: excludeReservationId };
  }
  return db
    .collection<ReservationDoc>(COLLECTION)
    .find(filter)
    .sort({ timeLocal: 1 })
    .toArray();
}

/**
 * Grilla de inicios de turno para un día: cada franja indica si está libre u ocupada
 * (otro turno, bloqueo de agenda o cupos llenos), excluyendo la reserva que se reprograma.
 */
export async function computeReprogramDayRows(
  db: Db,
  params: {
    dateKey: string;
    treatmentId: string;
    excludeReservationHexId: string | null;
    now: Date;
    scope: BookingSlotScope;
  },
): Promise<ReprogramDayRow[]> {
  const treatment = findSalonTreatmentById(params.treatmentId.trim());
  if (!treatment) return [];

  let excludeOid: ObjectId | undefined;
  const ex = params.excludeReservationHexId?.trim();
  if (ex && /^[a-f0-9]{24}$/i.test(ex)) {
    try {
      excludeOid = new ObjectIdCtor(ex);
    } catch {
      excludeOid = undefined;
    }
  }

  const { dateKey, scope } = params;
  let candidateSlots =
    scope === "public" ? getPublicBookableTimeSlots(dateKey, params.now) : getAvailableTimesForDate(dateKey);
  candidateSlots = filterSlotsServiceEndsOnOrBeforeClose(candidateSlots, treatment.durationMinutes, dateKey);
  candidateSlots = filterPublicSlotsByTreatmentRules(treatment.id, candidateSlots, dateKey);

  const available = await computeBookableSlots(db, {
    dateKey,
    treatmentId: treatment.id,
    now: params.now,
    scope,
    excludeReservationHexId: params.excludeReservationHexId,
  });
  const availableSet = new Set(available);

  const resRows = await listActiveReservationsForDayDisplay(db, dateKey, excludeOid);
  const resLabeled = resRows
    .map((r) => {
      const iv = slotIntervalMs(dateKey, r.timeLocal, reservationDurationMinutesFromDoc(r));
      if (!iv) return null;
      return {
        interval: iv,
        customerName:
          r.reservationStatus === "pending_payment"
            ? `${String(r.customerName ?? "").trim() || "Cliente"} · esperando pago`
            : String(r.customerName ?? "").trim() || "Cliente",
        treatmentName: String(r.treatmentName ?? "").trim() || "Turno",
      };
    })
    .filter(Boolean) as { interval: IntervalMs; customerName: string; treatmentName: string }[];

  const agendaDocs = await listSalonAgendaBlocksApplyingToDateKey(db, dateKey);
  const agendaLabeled = agendaDocs
    .map((doc) => {
      const iv = intervalForAgendaBlockOnDate(doc, dateKey);
      if (!iv) return null;
      return {
        interval: iv,
        scope: doc.scope,
        notes: doc.notes ?? null,
      };
    })
    .filter(Boolean) as { interval: IntervalMs; scope: string; notes: string | null }[];

  const rows: ReprogramDayRow[] = [];
  for (const t of candidateSlots) {
    const slot = slotIntervalMs(dateKey, t, treatment.durationMinutes);
    if (!slot) continue;

    if (availableSet.has(t)) {
      rows.push({ timeLocal: t, kind: "available" });
      continue;
    }

    const hitRes = resLabeled.find((r) => intervalsOverlap(slot, r.interval));
    if (hitRes) {
      rows.push({
        timeLocal: t,
        kind: "reserved",
        customerName: hitRes.customerName,
        treatmentName: hitRes.treatmentName,
      });
      continue;
    }

    const hitAg = agendaLabeled.find((a) => intervalsOverlap(slot, a.interval));
    if (hitAg) {
      rows.push({
        timeLocal: t,
        kind: "agenda_block",
        scope: hitAg.scope,
        notes: hitAg.notes,
      });
      continue;
    }

    rows.push({ timeLocal: t, kind: "capacity_full" });
  }

  return rows;
}

export async function computePanelReprogramDayRows(
  db: Db,
  params: {
    dateKey: string;
    treatmentId: string;
    excludeReservationHexId: string | null;
    now: Date;
  },
): Promise<ReprogramDayRow[]> {
  return computeReprogramDayRows(db, { ...params, scope: "panel" });
}
