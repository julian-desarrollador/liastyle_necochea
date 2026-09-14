import type { Db, ObjectId } from "mongodb";
import { formatInTimeZone } from "date-fns-tz";

import { RESERVATION_TZ } from "@/lib/booking/public-slot-lead";
import { findSalonTreatmentById } from "@/lib/treatments/catalog";

export type IntervalMs = { startMs: number; endMs: number };

export function intervalsOverlap(a: IntervalMs, b: IntervalMs): boolean {
  return a.startMs < b.endMs && a.endMs > b.startMs;
}

/** Día de semana local (0=dom … 6=sáb) para `yyyy-MM-dd`. */
function salonWeekdayFromDateKey(dateKey: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return undefined;
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d).getDay();
}

/**
 * Cupo base de turnos simultáneos (sillas operativas).
 * Jueves y sábados: 2 (Analia + ayudante). Resto de días abiertos: 1.
 */
export function salonBaseConcurrentCapForDateKey(dateKey: string): number {
  const wd = salonWeekdayFromDateKey(dateKey);
  if (wd === 4 || wd === 6) return 2;
  return 1;
}

/** Inicio/fin del turno en epoch ms (misma convención que `computeStartsAtUtc`, ART -03:00). */
export function slotIntervalMs(
  dateKey: string,
  timeLocal: string,
  durationMinutes: number,
): IntervalMs | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(timeLocal)) {
    return null;
  }
  const d = new Date(`${dateKey}T${timeLocal}:00-03:00`);
  if (Number.isNaN(d.getTime())) return null;
  const startMs = d.getTime();
  const endMs = startMs + durationMinutes * 60_000;
  return { startMs, endMs };
}

/** Capacidad del salón en ese instante (mismo día ART). */
export function salonConcurrentCapAtInstant(dateKey: string, instantMs: number): number {
  const dayKey = formatInTimeZone(new Date(instantMs), RESERVATION_TZ, "yyyy-MM-dd");
  if (dayKey !== dateKey) return 1;
  return salonBaseConcurrentCapForDateKey(dateKey);
}

const COLLECTION = "reservations";

/**
 * `holding`: confirmed + pending_payment vigente (el horario no se ofrece a otra clienta).
 * `confirmed`: solo turnos ya pagados/confirmados (para decidir quién gana si dos pagan a la vez).
 */
export type SlotOccupancyMode = "holding" | "confirmed";

export type ConfirmedCapacityRow = {
  id: ObjectId;
  interval: IntervalMs;
  approvedAtMs: number;
};

export function reservationDurationMinutesFromDoc(r: {
  durationMinutes?: unknown;
  treatmentId?: unknown;
}): number {
  if (typeof r.durationMinutes === "number" && Number.isFinite(r.durationMinutes) && r.durationMinutes > 0) {
    return r.durationMinutes;
  }
  const tid = String(r.treatmentId ?? "").trim();
  return findSalonTreatmentById(tid)?.durationMinutes ?? 60;
}

function durationForReservationRow(r: {
  durationMinutes?: unknown;
  treatmentId?: unknown;
  startsAt?: unknown;
}): number {
  return reservationDurationMinutesFromDoc(r);
}

export function slotOccupancyMongoFilter(
  occupancy: SlotOccupancyMode,
  now = new Date(),
): Record<string, unknown> {
  if (occupancy === "confirmed") {
    return { reservationStatus: "confirmed" };
  }
  return {
    $or: [
      { reservationStatus: "confirmed" },
      {
        reservationStatus: "pending_payment",
        $or: [{ paymentDeadlineAt: { $gt: now } }, { paymentDeadlineAt: null }, { paymentDeadlineAt: { $exists: false } }],
      },
    ],
  };
}

function occupancyQuery(
  dateKey: string,
  occupancy: SlotOccupancyMode,
  excludeReservationId?: ObjectId,
  now = new Date(),
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    dateKey,
    ...slotOccupancyMongoFilter(occupancy, now),
  };
  if (excludeReservationId) {
    filter._id = { $ne: excludeReservationId };
  }
  return filter;
}

function intervalFromReservationRow(r: {
  startsAt?: unknown;
  durationMinutes?: unknown;
  treatmentId?: unknown;
}): IntervalMs {
  const startsAt = r.startsAt instanceof Date ? r.startsAt : new Date(String(r.startsAt));
  const startMs = startsAt.getTime();
  const dur = durationForReservationRow(r);
  return { startMs, endMs: startMs + dur * 60_000 };
}

export async function loadBusyIntervalsMs(
  db: Db,
  dateKey: string,
  excludeReservationId?: ObjectId,
  occupancy: SlotOccupancyMode = "holding",
): Promise<IntervalMs[]> {
  const rows = await db
    .collection(COLLECTION)
    .find(occupancyQuery(dateKey, occupancy, excludeReservationId), {
      projection: { startsAt: 1, durationMinutes: 1, treatmentId: 1 },
    })
    .toArray();

  return rows.map((r) =>
    intervalFromReservationRow(r as { startsAt?: unknown; durationMinutes?: unknown; treatmentId?: unknown }),
  );
}

export async function loadConfirmedCapacityRows(db: Db, dateKey: string): Promise<ConfirmedCapacityRow[]> {
  const rows = await db
    .collection(COLLECTION)
    .find(
      { dateKey, reservationStatus: "confirmed" },
      {
        projection: { startsAt: 1, durationMinutes: 1, treatmentId: 1, mpPaymentApprovedAt: 1, createdAt: 1 },
      },
    )
    .toArray();

  return rows.map((r) => {
    const paidAt = r.mpPaymentApprovedAt instanceof Date ? r.mpPaymentApprovedAt.getTime() : null;
    const createdAt = r.createdAt instanceof Date ? r.createdAt.getTime() : 0;
    const approvedAtMs = paidAt ?? createdAt;
    return {
      id: r._id as ObjectId,
      interval: intervalFromReservationRow(
        r as { startsAt?: unknown; durationMinutes?: unknown; treatmentId?: unknown },
      ),
      approvedAtMs: Number.isFinite(approvedAtMs) ? approvedAtMs : 0,
    };
  });
}

function confirmSeatRank(approvedAtMs: number, id: ObjectId): string {
  return `${String(approvedAtMs).padStart(16, "0")}:${id.toHexString()}`;
}

/**
 * Tras confirmar un pago: ¿esta reserva se queda con el cupo, o otra ya confirmada tiene prioridad?
 * Gana quien confirmó antes (pago MP o, si no hay pago, `createdAt` del panel). Empate por `_id`.
 */
export function selfKeepsConfirmedSeat(
  dateKey: string,
  selfId: ObjectId,
  selfInterval: IntervalMs,
  selfApprovedAtMs: number,
  allConfirmed: ConfirmedCapacityRow[],
  getEffectiveCap?: (instantMs: number) => number,
): boolean {
  const selfRank = confirmSeatRank(selfApprovedAtMs, selfId);
  const earlierBusy = allConfirmed
    .filter((row) => {
      if (row.id.equals(selfId)) return false;
      if (!intervalsOverlap(row.interval, selfInterval)) return false;
      return confirmSeatRank(row.approvedAtMs, row.id) < selfRank;
    })
    .map((row) => row.interval);
  return canPlaceReservationSlot(dateKey, selfInterval, earlierBusy, getEffectiveCap);
}

/**
 * ¿Se puede agregar este intervalo sin superar la capacidad por franja?
 * Jueves y sábados: hasta 2 turnos simultáneos; resto de días abiertos: 1.
 * `getEffectiveCap` permite reducir cupos por bloqueos de agenda (silla / salón).
 */
export function canPlaceReservationSlot(
  dateKey: string,
  candidate: IntervalMs,
  busy: IntervalMs[],
  getEffectiveCap?: (instantMs: number) => number,
): boolean {
  const relevant = busy.filter((b) => intervalsOverlap(b, candidate));
  const points = new Set<number>([candidate.startMs, candidate.endMs]);
  for (const b of relevant) {
    const s = Math.max(b.startMs, candidate.startMs);
    const e = Math.min(b.endMs, candidate.endMs);
    if (s < e) {
      points.add(s);
      points.add(e);
    }
  }

  const sorted = [...points].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i];
    const t1 = sorted[i + 1];
    if (t1 <= t0) continue;
    const lo = Math.max(t0, candidate.startMs);
    const hi = Math.min(t1, candidate.endMs);
    if (hi <= lo) continue;
    const mid = (lo + hi) / 2;
    const cap = getEffectiveCap ? getEffectiveCap(mid) : salonConcurrentCapAtInstant(dateKey, mid);
    let depth = 0;
    for (const b of relevant) {
      if (b.startMs < hi && b.endMs > lo) depth++;
    }
    if (depth + 1 > cap) return false;
  }
  return true;
}

/** True si en algún tramo del intervalo el cupo efectivo es 0 (bloqueo de salón / sillas). */
export function intervalHasZeroEffectiveCap(
  dateKey: string,
  candidate: IntervalMs,
  getEffectiveCap?: (instantMs: number) => number,
): boolean {
  const capAt = getEffectiveCap ?? ((ms: number) => salonConcurrentCapAtInstant(dateKey, ms));
  const step = 15 * 60_000;
  for (let t = candidate.startMs; t < candidate.endMs; t += step) {
    if (capAt(t + 1) <= 0) return true;
  }
  return capAt(Math.max(candidate.startMs, candidate.endMs - 1)) <= 0;
}

export function filterSlotsBySalonCapacity(
  slots: string[],
  dateKey: string,
  durationMinutes: number,
  busy: IntervalMs[],
  getEffectiveCap?: (instantMs: number) => number,
): string[] {
  return slots.filter((timeLocal) => {
    const slot = slotIntervalMs(dateKey, timeLocal, durationMinutes);
    if (!slot) return false;
    return canPlaceReservationSlot(dateKey, slot, busy, getEffectiveCap);
  });
}

/** Horarios que siguen en grilla pero ya no tienen cupo (sobreturno). */
export function slotsExceedingSalonCapacity(
  slots: string[],
  dateKey: string,
  durationMinutes: number,
  busy: IntervalMs[],
  getEffectiveCap?: (instantMs: number) => number,
): string[] {
  return slots.filter((timeLocal) => {
    const slot = slotIntervalMs(dateKey, timeLocal, durationMinutes);
    if (!slot) return false;
    return !canPlaceReservationSlot(dateKey, slot, busy, getEffectiveCap);
  });
}

export async function reservationWouldExceedSalonCapacity(
  db: Db,
  dateKey: string,
  candidate: IntervalMs,
  getEffectiveCap?: (instantMs: number) => number,
  excludeReservationId?: ObjectId,
  occupancy: SlotOccupancyMode = "holding",
): Promise<boolean> {
  const busy = await loadBusyIntervalsMs(db, dateKey, excludeReservationId, occupancy);
  return !canPlaceReservationSlot(dateKey, candidate, busy, getEffectiveCap);
}
