import { randomBytes } from "crypto";
import type { Db, ObjectId } from "mongodb";
import { MongoServerError, ObjectId as ObjectIdCtor } from "mongodb";

import { buildCapGetterForDate } from "@/lib/booking/agenda-blocks";
import {
  computeBookableSlots,
  computeBookableSlotsForTreatmentIds,
  type BookingSlotScope,
} from "@/lib/booking/compute-bookable-slots";
import { formatSalonDisplayDate } from "@/lib/booking/salon-availability";
import { canonicalPhoneDigitsAR, customerPhoneDigitsQueryValues } from "@/lib/customer/phone-canonical-ar";
import { isPublicLeadTimeViolated } from "@/lib/booking/public-slot-lead";
import { refundMercadoPagoPayment } from "@/lib/mercadopago/refund-payment";
import {
  loadConfirmedCapacityRows,
  reservationDurationMinutesFromDoc,
  reservationWouldExceedSalonCapacity,
  selfKeepsConfirmedSeat,
  slotIntervalMs,
} from "@/lib/booking/slot-overlap";
import { validateServiceCombo } from "@/lib/treatments/booking-rules";
import { SALON_TREATMENTS, findSalonTreatmentById, type SalonTreatment } from "@/lib/treatments/catalog";
import { PUBLIC_DEPOSIT_RATE, summarizeDepositForTreatments } from "@/lib/treatments/deposit";

import { backfillCustomerPhoneDigitsBatch, renormalizeCustomerPhoneDigitsBatch } from "@/lib/reservations/customer-queries";
import {
  canCustomerCancelByStartsAt,
  CUSTOMER_CANCEL_TOO_LATE_MESSAGE,
} from "@/lib/reservations/cancel-policy";

import type {
  CreateReservationInput,
  MpWebhookEventDoc,
  ReservationDoc,
  ReservationServiceItem,
  ReservationStatus,
} from "./types";

const COLLECTION = "reservations";
const WEBHOOK_LOGS = "mp_webhook_events";

/** Argentina: sin DST desde 2009; offset fijo UTC-3 para armar el instante del turno. */
export function computeStartsAtUtc(dateKey: string, timeLocal: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(timeLocal)) {
    return null;
  }
  const isoLocal = `${dateKey}T${timeLocal}:00`;
  const withOffset = `${isoLocal}-03:00`;
  const d = new Date(withOffset);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Tiempo que un “Esperando pago” ocupa el horario si no se configura otra cosa. */
const DEFAULT_PENDING_TTL_MINUTES = 60;

function pendingTtlMs(): number {
  const raw = process.env.PENDING_RESERVATION_TTL_MINUTES;
  const n = raw ? Number(raw) : DEFAULT_PENDING_TTL_MINUTES;
  if (!Number.isFinite(n) || n < 5 || n > 10080) return DEFAULT_PENDING_TTL_MINUTES * 60 * 1000;
  return n * 60 * 1000;
}

/** Subir si cambia la definición de índices o la normalización de teléfonos (fuerza re-backfill). */
const RESERVATION_INDEXES_VERSION = 5;
let reservationIndexesVersionApplied = 0;

export async function ensureReservationIndexes(db: Db) {
  if (reservationIndexesVersionApplied >= RESERVATION_INDEXES_VERSION) return;
  const col = db.collection(COLLECTION);
  const logs = db.collection(WEBHOOK_LOGS);

  try {
    await col.dropIndex("uniq_startsAt");
  } catch {
    /* no existe */
  }
  try {
    await col.dropIndex("uniq_startsAt_active_pending_or_confirmed");
  } catch {
    /* no existe */
  }

  await col.createIndex({ startsAt: 1 }, { name: "by_startsAt" });
  await col.createIndex({ createdAt: -1 }, { name: "by_created" });
  await col.createIndex({ reservationStatus: 1, startsAt: 1 }, { name: "by_status_starts" });
  await col.createIndex({ externalReference: 1 }, { sparse: true, name: "by_external_ref" });
  await col.createIndex({ paymentDeadlineAt: 1 }, { sparse: true, name: "by_payment_deadline" });
  await col.createIndex({ customerPhoneDigits: 1, startsAt: -1 }, { name: "by_customer_phone_starts" });
  await col.createIndex(
    { waReminder24hMessageSid: 1 },
    { unique: true, sparse: true, name: "by_wa_reminder_message_sid" },
  );

  await logs.createIndex({ receivedAt: -1 }, { name: "mp_logs_received" });
  await logs.createIndex({ resourceId: 1, receivedAt: -1 }, { name: "mp_logs_resource" });

  // Rellena documentos sin el campo customerPhoneDigits
  for (let i = 0; i < 20; i++) {
    const n = await backfillCustomerPhoneDigitsBatch(db, 250);
    if (n === 0) break;
  }

  // Re-normaliza documentos con formas canónicas incorrectas (prefijo "0" o "9" sin strip)
  for (let i = 0; i < 20; i++) {
    const n = await renormalizeCustomerPhoneDigitsBatch(db, 250);
    if (n === 0) break;
  }

  reservationIndexesVersionApplied = RESERVATION_INDEXES_VERSION;
}

type PublicTurnosValidation =
  | {
      ok: true;
      startsAt: Date;
      now: Date;
      primaryTreatment: SalonTreatment;
      serviceItems: ReservationServiceItem[];
      totalDurationMinutes: number;
      isCombo: boolean;
    }
  | { ok: false; error: string; code?: string };

function buildServiceItemsForInput(input: CreateReservationInput): {
  primaryTreatment: SalonTreatment;
  serviceItems: ReservationServiceItem[];
  isCombo: boolean;
} | null {
  const comboIds = (input.serviceIds ?? []).map((v) => v.trim()).filter(Boolean);
  const uniqueIds = [...new Set(comboIds)];
  const comboError = validateServiceCombo(uniqueIds);
  if (comboError) return null;
  if (uniqueIds.length > 0) {
    const treatments = uniqueIds
      .map((id) => findSalonTreatmentById(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    if (treatments.length !== uniqueIds.length) return null;
    const items = treatments.map((t) => ({
        treatmentId: t.id,
        treatmentName: t.name,
        subtitle: t.subtitle,
        category: t.category,
        durationMinutes: t.durationMinutes,
      })) satisfies ReservationServiceItem[];
    return {
      primaryTreatment: treatments[0] as SalonTreatment,
      serviceItems: items,
      isCombo: items.length > 1,
    };
  }
  const treatment = findSalonTreatmentById(input.treatmentId.trim());
  if (!treatment) return null;
  return {
    primaryTreatment: treatment,
    serviceItems: [
      {
        treatmentId: treatment.id,
        treatmentName: treatment.name,
        subtitle: treatment.subtitle,
        category: treatment.category,
        durationMinutes: treatment.durationMinutes,
      },
    ],
    isCombo: false,
  };
}

async function validatePublicTurnosReservation(
  db: Db,
  input: CreateReservationInput,
): Promise<PublicTurnosValidation> {
  const parsedServices = buildServiceItemsForInput(input);
  if (!parsedServices) {
    return { ok: false, error: "Tratamiento inválido.", code: "INVALID_TREATMENT" };
  }
  const { primaryTreatment, serviceItems, isCombo } = parsedServices;
  const totalDurationMinutes = serviceItems.reduce((acc, s) => acc + s.durationMinutes, 0);

  const startsAt = computeStartsAtUtc(input.dateKey, input.timeLocal);
  if (!startsAt) {
    return { ok: false, error: "Fecha u horario inválidos.", code: "INVALID_SLOT" };
  }

  const now = new Date();
  if (isPublicLeadTimeViolated(input.dateKey, startsAt, now)) {
    return {
      ok: false,
      error: "Los turnos web solo se pueden reservar a partir de mañana (no el mismo día).",
      code: "LEAD_TIME",
    };
  }

  await ensureReservationIndexes(db);

  const allowedPublic =
    serviceItems.length > 1
      ? await computeBookableSlotsForTreatmentIds(db, {
          dateKey: input.dateKey,
          treatmentIds: serviceItems.map((s) => s.treatmentId),
          now,
          scope: "public",
        })
      : await computeBookableSlots(db, {
          dateKey: input.dateKey,
          treatmentId: primaryTreatment.id,
          now,
          scope: "public",
        });
  if (!allowedPublic.includes(input.timeLocal.trim())) {
    return {
      ok: false,
      error: "Ese horario no está disponible para este servicio.",
      code: "SLOT_UNAVAILABLE",
    };
  }

  const interval = slotIntervalMs(input.dateKey, input.timeLocal.trim(), totalDurationMinutes);
  if (!interval) {
    return { ok: false, error: "Fecha u horario inválidos.", code: "INVALID_SLOT" };
  }
  const capGetter = await buildCapGetterForDate(db, input.dateKey);
  if (await reservationWouldExceedSalonCapacity(db, input.dateKey, interval, capGetter)) {
    return {
      ok: false,
      error: "Ese horario ya está reservado o esperando el pago de otra clienta.",
      code: "SLOT_OVERLAP",
    };
  }

  return { ok: true, startsAt, now, primaryTreatment, serviceItems, totalDurationMinutes, isCombo };
}

export async function insertPendingReservation(
  db: Db,
  input: CreateReservationInput,
): Promise<
  | {
      id: string;
      checkoutToken: string;
      externalReference: string;
      depositAmountArs: number;
      depositPriceIsFrom: boolean;
    }
  | { error: string; code?: string }
> {
  const v = await validatePublicTurnosReservation(db, input);
  if (!v.ok) return { error: v.error, code: v.code };
  const { primaryTreatment, serviceItems, totalDurationMinutes, isCombo, startsAt, now } = v;

  const checkoutToken = randomBytes(32).toString("hex");
  const paymentDeadlineAt = new Date(now.getTime() + pendingTtlMs());
  const treatmentNameCombo = serviceItems.map((s) => s.treatmentName).join(" + ");
  const subtitleCombo = `${serviceItems.length} servicios · ${totalDurationMinutes} min`;

  const depositTreatments = serviceItems
    .map((s) => findSalonTreatmentById(s.treatmentId))
    .filter((t): t is SalonTreatment => Boolean(t));
  const deposit = summarizeDepositForTreatments(
    depositTreatments.length > 0 ? depositTreatments : [primaryTreatment],
  );

  const doc = {
    treatmentId: primaryTreatment.id,
    treatmentName: isCombo ? treatmentNameCombo : primaryTreatment.name,
    subtitle: isCombo ? subtitleCombo : primaryTreatment.subtitle,
    category: primaryTreatment.category,
    dateKey: input.dateKey,
    timeLocal: input.timeLocal,
    displayDate: input.displayDate,
    startsAt,
    durationMinutes: totalDurationMinutes,
    totalDurationMinutes,
    serviceItems,
    bookingMode: isCombo ? "combo" : "single",
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerPhoneDigits: canonicalPhoneDigitsAR(input.customerPhone.trim()),
    whatsappOptIn: input.whatsappOptIn,
    reservationStatus: "pending_payment" as ReservationStatus,
    paymentStatus: "pending" as const,
    depositAmountArs: deposit.depositAmountArs,
    depositRate: PUBLIC_DEPOSIT_RATE,
    depositPriceIsFrom: deposit.priceIsFrom,
    source: "app_turnos" as const,
    createdAt: now,
    updatedAt: now,
    checkoutToken,
    paymentDeadlineAt,
  } satisfies Omit<ReservationDoc, "_id" | "externalReference" | "preferenceId" | "mpPaymentId">;

  try {
    const result = await db.collection(COLLECTION).insertOne(doc);
    const id = result.insertedId.toHexString();
    await db.collection(COLLECTION).updateOne(
      { _id: result.insertedId },
      { $set: { externalReference: id, updatedAt: new Date() } },
    );
    return {
      id,
      checkoutToken,
      externalReference: id,
      depositAmountArs: deposit.depositAmountArs,
      depositPriceIsFrom: deposit.priceIsFrom,
    };
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      return {
        error: "Ese horario ya está ocupado o tiene una reserva pendiente. Elegí otro día u horario.",
        code: "SLOT_TAKEN",
      };
    }
    throw e;
  }
}

/**
 * Reserva desde la app pública sin seña online: confirmada de inmediato
 * (cortes básicos / peinados simples).
 */
export async function insertPublicConfirmedReservationWithoutPayment(
  db: Db,
  input: CreateReservationInput,
): Promise<
  | {
      ok: true;
      id: string;
      externalReference: string;
      depositAmountArs: number;
      depositPriceIsFrom: boolean;
    }
  | { error: string; code?: string }
> {
  const v = await validatePublicTurnosReservation(db, input);
  if (!v.ok) return { error: v.error, code: v.code };
  const { primaryTreatment, serviceItems, totalDurationMinutes, isCombo, startsAt, now } = v;

  const dateKey = input.dateKey.trim();
  const timeLocal = input.timeLocal.trim();
  const displayDate = formatSalonDisplayDate(dateKey);
  const treatmentNameCombo = serviceItems.map((s) => s.treatmentName).join(" + ");
  const subtitleCombo = `${serviceItems.length} servicios · ${totalDurationMinutes} min`;

  const depositTreatments = serviceItems
    .map((s) => findSalonTreatmentById(s.treatmentId))
    .filter((t): t is SalonTreatment => Boolean(t));
  const deposit = summarizeDepositForTreatments(
    depositTreatments.length > 0 ? depositTreatments : [primaryTreatment],
  );

  const doc = {
    treatmentId: primaryTreatment.id,
    treatmentName: isCombo ? treatmentNameCombo : primaryTreatment.name,
    subtitle: isCombo ? subtitleCombo : primaryTreatment.subtitle,
    category: primaryTreatment.category,
    dateKey,
    timeLocal,
    displayDate,
    startsAt,
    durationMinutes: totalDurationMinutes,
    totalDurationMinutes,
    serviceItems,
    bookingMode: isCombo ? "combo" : "single",
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    customerPhoneDigits: canonicalPhoneDigitsAR(input.customerPhone.trim()),
    whatsappOptIn: input.whatsappOptIn === true,
    reservationStatus: "confirmed" as const,
    paymentStatus: "not_required" as const,
    depositAmountArs: deposit.depositAmountArs,
    depositRate: PUBLIC_DEPOSIT_RATE,
    depositPriceIsFrom: deposit.priceIsFrom,
    source: "app_turnos" as const,
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<
    ReservationDoc,
    | "_id"
    | "externalReference"
    | "preferenceId"
    | "mpPaymentId"
    | "checkoutToken"
    | "paymentDeadlineAt"
    | "mpPaymentStatusLast"
    | "mpPaymentApprovedAt"
    | "cancelReason"
    | "waReminder24hSentAt"
    | "createdBy"
    | "panelNotes"
  >;

  try {
    const result = await db.collection(COLLECTION).insertOne(doc);
    const id = result.insertedId.toHexString();
    await db.collection(COLLECTION).updateOne(
      { _id: result.insertedId },
      { $set: { externalReference: id, updatedAt: new Date() } },
    );
    return {
      ok: true,
      id,
      externalReference: id,
      depositAmountArs: deposit.depositAmountArs,
      depositPriceIsFrom: deposit.priceIsFrom,
    };
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      return {
        error: "Ese horario ya está ocupado o tiene una reserva pendiente. Elegí otro día u horario.",
        code: "SLOT_TAKEN",
      };
    }
    throw e;
  }
}

export type PanelReservationInsertInput = {
  treatmentId: string;
  serviceIds?: string[];
  dateKey: string;
  timeLocal: string;
  customerName: string;
  customerPhone: string;
  whatsappOptIn: boolean;
  panelNotes?: string | null;
};

const PANEL_NOTES_MAX_LEN = 2000;

async function validatePanelReservation(
  db: Db,
  input: Pick<PanelReservationInsertInput, "treatmentId" | "serviceIds" | "dateKey" | "timeLocal">,
): Promise<PublicTurnosValidation> {
  const parsedServices = buildServiceItemsForInput({
    treatmentId: input.treatmentId,
    serviceIds: input.serviceIds,
  } as CreateReservationInput);
  if (!parsedServices) {
    return { ok: false, error: "Tratamiento inválido.", code: "INVALID_TREATMENT" };
  }
  const { primaryTreatment, serviceItems, isCombo } = parsedServices;
  const totalDurationMinutes = serviceItems.reduce((acc, s) => acc + s.durationMinutes, 0);

  const dateKey = input.dateKey.trim();
  const timeLocal = input.timeLocal.trim();
  const startsAt = computeStartsAtUtc(dateKey, timeLocal);
  if (!startsAt) {
    return { ok: false, error: "Fecha u horario inválidos.", code: "INVALID_SLOT" };
  }

  const now = new Date();
  await ensureReservationIndexes(db);

  const allowedTimes =
    serviceItems.length > 1
      ? await computeBookableSlotsForTreatmentIds(db, {
          dateKey,
          treatmentIds: serviceItems.map((s) => s.treatmentId),
          now,
          scope: "panel",
          allowOverCapacity: true,
        })
      : await computeBookableSlots(db, {
          dateKey,
          treatmentId: primaryTreatment.id,
          now,
          scope: "panel",
          allowOverCapacity: true,
        });
  if (!allowedTimes.includes(timeLocal)) {
    return { ok: false, error: "Ese horario no está disponible.", code: "SLOT_UNAVAILABLE" };
  }

  const interval = slotIntervalMs(dateKey, timeLocal, totalDurationMinutes);
  if (!interval) {
    return { ok: false, error: "Fecha u horario inválidos.", code: "INVALID_SLOT" };
  }

  return { ok: true, startsAt, now, primaryTreatment, serviceItems, totalDurationMinutes, isCombo };
}

/**
 * Alta manual desde el panel (sin Mercado Pago). Permite sobreturno (cupo excedido).
 */
export async function insertPanelReservation(
  db: Db,
  input: PanelReservationInsertInput,
): Promise<{ ok: true; id: string } | { error: string; code?: string }> {
  const v = await validatePanelReservation(db, input);
  if (!v.ok) return { error: v.error, code: v.code };

  const { primaryTreatment, serviceItems, totalDurationMinutes, isCombo, startsAt, now } = v;
  const dateKey = input.dateKey.trim();
  const timeLocal = input.timeLocal.trim();

  let panelNotes: string | null = null;
  if (input.panelNotes != null && String(input.panelNotes).trim()) {
    const t = String(input.panelNotes).trim();
    if (t.length > PANEL_NOTES_MAX_LEN) {
      return { error: `Las notas no pueden superar ${PANEL_NOTES_MAX_LEN} caracteres.` };
    }
    panelNotes = t;
  }

  const displayDate = formatSalonDisplayDate(dateKey);
  const createdBy = (process.env.PANEL_TURNOS_CREATED_BY ?? "panel").trim() || "panel";
  const treatmentNameCombo = serviceItems.map((s) => s.treatmentName).join(" + ");
  const subtitleCombo = `${serviceItems.length} servicios · ${totalDurationMinutes} min`;

  const doc = {
    treatmentId: primaryTreatment.id,
    treatmentName: isCombo ? treatmentNameCombo : primaryTreatment.name,
    subtitle: isCombo ? subtitleCombo : primaryTreatment.subtitle,
    category: primaryTreatment.category,
    dateKey,
    timeLocal,
    displayDate,
    startsAt,
    durationMinutes: totalDurationMinutes,
    totalDurationMinutes,
    serviceItems,
    bookingMode: isCombo ? "combo" : "single",
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    customerPhoneDigits: canonicalPhoneDigitsAR(input.customerPhone.trim()),
    whatsappOptIn: input.whatsappOptIn === true,
    reservationStatus: "confirmed" as const,
    paymentStatus: "not_required" as const,
    source: "panel" as const,
    createdBy,
    panelNotes,
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<
    ReservationDoc,
    | "_id"
    | "externalReference"
    | "preferenceId"
    | "mpPaymentId"
    | "checkoutToken"
    | "paymentDeadlineAt"
    | "mpPaymentStatusLast"
    | "mpPaymentApprovedAt"
    | "cancelReason"
    | "waReminder24hSentAt"
  >;

  try {
    const result = await db.collection(COLLECTION).insertOne(doc);
    const id = result.insertedId.toHexString();
    await db.collection(COLLECTION).updateOne(
      { _id: result.insertedId },
      { $set: { externalReference: id, updatedAt: new Date() } },
    );
    return { ok: true, id };
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) {
      return {
        error: "Ese horario ya está ocupado. Elegí otro.",
        code: "SLOT_TAKEN",
      };
    }
    throw e;
  }
}

export async function findReservationByHexId(db: Db, hexId: string): Promise<ReservationDoc | null> {
  try {
    const _id = new ObjectIdCtor(hexId);
    const doc = await db.collection<ReservationDoc>(COLLECTION).findOne({ _id });
    return doc ?? null;
  } catch {
    return null;
  }
}

const RESCHEDULEABLE_STATUSES: ReservationStatus[] = ["confirmed", "pending_payment"];
const CANCELLABLE_STATUSES: ReservationStatus[] = ["confirmed", "pending_payment"];

/**
 * Cambia día/hora de una reserva (mismo tratamiento y duración).
 * Cliente: solo su WhatsApp; panel: cualquier turno movible.
 */
export async function rescheduleReservation(
  db: Db,
  input: {
    reservationHexId: string;
    newDateKey: string;
    newTimeLocal: string;
    now: Date;
    actor: "panel" | "customer";
    customerCanonicalDigits?: string | null;
  },
): Promise<{ ok: true } | { error: string; code?: string }> {
  await ensureReservationIndexes(db);
  const hex = input.reservationHexId.trim();
  const doc = await findReservationByHexId(db, hex);
  if (!doc) {
    return { error: "Turno no encontrado.", code: "NOT_FOUND" };
  }
  if (!RESCHEDULEABLE_STATUSES.includes(doc.reservationStatus)) {
    return { error: "Este turno no se puede reprogramar (cancelado o finalizado).", code: "NOT_MOVABLE" };
  }

  if (input.actor === "customer") {
    const canon = input.customerCanonicalDigits?.trim();
    if (!canon) {
      return { error: "Tenés que iniciar sesión en tu perfil.", code: "UNAUTHORIZED" };
    }
    const docDigits = doc.customerPhoneDigits ?? canonicalPhoneDigitsAR(doc.customerPhone);
    if (!customerPhoneDigitsQueryValues(canon).includes(docDigits)) {
      return { error: "No podés modificar un turno de otro cliente.", code: "FORBIDDEN" };
    }
  }

  const newKey = input.newDateKey.trim();
  const newTime = input.newTimeLocal.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newKey) || !/^\d{2}:\d{2}$/.test(newTime)) {
    return { error: "Fecha u horario inválidos.", code: "INVALID_SLOT" };
  }

  if (doc.dateKey === newKey && doc.timeLocal === newTime) {
    return { error: "Elegí un día u horario distinto al actual.", code: "NO_CHANGE" };
  }

  const startsAtNew = computeStartsAtUtc(newKey, newTime);
  if (!startsAtNew) {
    return { error: "Fecha u horario inválidos.", code: "INVALID_SLOT" };
  }

  if (input.actor === "customer" && doc.source === "app_turnos") {
    if (isPublicLeadTimeViolated(newKey, startsAtNew, input.now)) {
      return {
        error: "Los turnos web solo se pueden reservar a partir de mañana (no el mismo día).",
        code: "LEAD_TIME",
      };
    }
  }

  const treatmentId = doc.treatmentId.trim();
  const catalog = findSalonTreatmentById(treatmentId);
  const duration =
    typeof doc.durationMinutes === "number" && Number.isFinite(doc.durationMinutes) && doc.durationMinutes > 0
      ? doc.durationMinutes
      : catalog?.durationMinutes ?? 60;

  const slotScope: BookingSlotScope =
    input.actor === "panel" ? "panel" : doc.source === "panel" ? "panel" : "public";

  const allowed = await computeBookableSlots(db, {
    dateKey: newKey,
    treatmentId,
    now: input.now,
    scope: slotScope,
    excludeReservationHexId: hex,
    allowOverCapacity: input.actor === "panel",
  });
  if (!allowed.includes(newTime)) {
    return { error: "Ese horario no está disponible para este servicio.", code: "SLOT_UNAVAILABLE" };
  }

  let excludeOid: ObjectId;
  try {
    excludeOid = new ObjectIdCtor(hex);
  } catch {
    return { error: "Turno no encontrado.", code: "NOT_FOUND" };
  }

  const interval = slotIntervalMs(newKey, newTime, duration);
  if (!interval) {
    return { error: "Fecha u horario inválidos.", code: "INVALID_SLOT" };
  }
  if (input.actor !== "panel") {
    const capGetter = await buildCapGetterForDate(db, newKey);
    if (await reservationWouldExceedSalonCapacity(db, newKey, interval, capGetter, excludeOid)) {
      return {
        error: "Ese horario ya está reservado o esperando el pago de otra clienta.",
        code: "SLOT_OVERLAP",
      };
    }
  }

  const displayDate = formatSalonDisplayDate(newKey);
  const updatedAt = new Date();
  const result = await db.collection<ReservationDoc>(COLLECTION).updateOne(
    { _id: doc._id, reservationStatus: doc.reservationStatus },
    {
      $set: {
        dateKey: newKey,
        timeLocal: newTime,
        startsAt: startsAtNew,
        displayDate,
        updatedAt,
      },
      $unset: {
        waReminder24hSentAt: "",
        waReminder24hMessageSid: "",
        waReminder24hStatus: "",
        waAttendanceConfirmedAt: "",
      },
    },
  );

  if (result.modifiedCount !== 1) {
    return { error: "No se pudo actualizar el turno. Probá de nuevo.", code: "CONFLICT" };
  }

  return { ok: true as const };
}

/** Registra que la clienta tocó «Confirmar» en WhatsApp, sin cambiar el pago. */
export async function confirmAttendanceViaWhatsApp(
  db: Db,
  input: {
    reservationHexId: string;
    expectedReminderSid: string;
    now?: Date;
  },
): Promise<{ ok: true; already?: boolean } | { error: string; code?: string }> {
  await ensureReservationIndexes(db);
  const hex = input.reservationHexId.trim();
  const doc = await findReservationByHexId(db, hex);
  if (!doc) {
    return { error: "Turno no encontrado.", code: "NOT_FOUND" };
  }
  if (doc.reservationStatus === "cancelled") {
    return { error: "El turno está cancelado.", code: "CANCELLED" };
  }
  if (doc.waReminder24hMessageSid !== input.expectedReminderSid) {
    return { error: "Ese recordatorio ya no está vigente.", code: "STALE_REMINDER" };
  }
  if (doc.waAttendanceConfirmedAt) {
    return { ok: true, already: true };
  }

  const now = input.now ?? new Date();
  const result = await db.collection<ReservationDoc>(COLLECTION).updateOne(
    {
      _id: doc._id,
      reservationStatus: { $in: ["confirmed", "pending_payment"] },
      waReminder24hMessageSid: input.expectedReminderSid,
      $or: [
        { waAttendanceConfirmedAt: null },
        { waAttendanceConfirmedAt: { $exists: false } },
      ],
    },
    { $set: { waAttendanceConfirmedAt: now, updatedAt: now } },
  );

  if (result.modifiedCount !== 1) {
    const current = await findReservationByHexId(db, hex);
    if (current?.waAttendanceConfirmedAt) return { ok: true, already: true };
    return { error: "No se pudo registrar la confirmación.", code: "CONFLICT" };
  }
  return { ok: true };
}

/**
 * Cancela una reserva activa.
 * Cliente o WhatsApp: solo su teléfono y con 24 h; panel: cualquier turno cancelable.
 */
export async function cancelReservation(
  db: Db,
  input: {
    reservationHexId: string;
    now: Date;
    actor: "panel" | "customer" | "whatsapp";
    customerCanonicalDigits?: string | null;
    expectedReminderSid?: string | null;
    cancelReason?: string | null;
  },
): Promise<{ ok: true } | { error: string; code?: string }> {
  await ensureReservationIndexes(db);
  const hex = input.reservationHexId.trim();
  const doc = await findReservationByHexId(db, hex);
  if (!doc) {
    return { error: "Turno no encontrado.", code: "NOT_FOUND" };
  }
  if (!CANCELLABLE_STATUSES.includes(doc.reservationStatus)) {
    return { error: "Este turno no se puede cancelar.", code: "NOT_CANCELLABLE" };
  }

  if (input.actor === "customer" || input.actor === "whatsapp") {
    const canon = input.customerCanonicalDigits?.trim();
    if (!canon) {
      return {
        error:
          input.actor === "customer"
            ? "Tenés que iniciar sesión en tu perfil."
            : "No pudimos reconocer tu teléfono.",
        code: "UNAUTHORIZED",
      };
    }
    const docDigits = doc.customerPhoneDigits ?? canonicalPhoneDigitsAR(doc.customerPhone);
    if (!customerPhoneDigitsQueryValues(canon).includes(docDigits)) {
      return { error: "No podés modificar un turno de otro cliente.", code: "FORBIDDEN" };
    }
    if (
      input.actor === "whatsapp" &&
      (!input.expectedReminderSid ||
        doc.waReminder24hMessageSid !== input.expectedReminderSid)
    ) {
      return { error: "Ese recordatorio ya no está vigente.", code: "STALE_REMINDER" };
    }
    if (!canCustomerCancelByStartsAt(doc.startsAt, input.now)) {
      return { error: CUSTOMER_CANCEL_TOO_LATE_MESSAGE, code: "TOO_LATE" };
    }
  }

  const updatedAt = input.now;
  const reasonRaw = String(input.cancelReason ?? "").trim();
  const reason = reasonRaw.length > 160 ? reasonRaw.slice(0, 160) : reasonRaw;
  const result = await db.collection<ReservationDoc>(COLLECTION).updateOne(
    {
      _id: doc._id,
      reservationStatus: doc.reservationStatus,
      ...(input.actor === "whatsapp"
        ? { waReminder24hMessageSid: input.expectedReminderSid }
        : {}),
    },
    {
      $set: {
        reservationStatus: "cancelled",
        cancelReason: reason || undefined,
        cancelledBy: input.actor,
        updatedAt,
      },
      $unset: {
        waReminder24hSentAt: "",
        waReminder24hMessageSid: "",
        waReminder24hStatus: "",
        waAttendanceConfirmedAt: "",
      },
    },
  );
  if (result.modifiedCount !== 1) {
    return { error: "No se pudo cancelar el turno. Probá de nuevo.", code: "CONFLICT" };
  }
  return { ok: true as const };
}

export async function attachPreferenceToReservation(
  db: Db,
  reservationId: ObjectId,
  preferenceId: string,
): Promise<boolean> {
  const r = await db.collection(COLLECTION).updateOne(
    { _id: reservationId, reservationStatus: "pending_payment" },
    { $set: { preferenceId, updatedAt: new Date() } },
  );
  return r.modifiedCount === 1;
}

export type MpPaymentPayload = {
  id: number | string;
  status: string;
  external_reference?: string | null;
};

async function refundApprovedPaymentAndMark(
  db: Db,
  reservation: ReservationDoc,
  paymentIdStr: string,
): Promise<boolean> {
  const refund = await refundMercadoPagoPayment(
    paymentIdStr,
    `ls-refund-${reservation._id.toHexString()}-${paymentIdStr}`.slice(0, 64),
  );
  const now = new Date();
  await db.collection(COLLECTION).updateOne(
    { _id: reservation._id },
    {
      $set: {
        mpPaymentId: paymentIdStr,
        mpPaymentStatusLast: refund.ok ? "refunded" : "approved",
        paymentStatus: refund.ok ? "refunded" : "approved",
        updatedAt: now,
      },
    },
  );
  if (!refund.ok) {
    console.error("[reservations] refund after payment without seat", refund.error, reservation._id.toHexString());
  }
  return refund.ok;
}

async function releasePendingAfterUnusablePayment(
  db: Db,
  reservation: ReservationDoc,
  paymentIdStr: string,
  cancelReason: string,
): Promise<boolean> {
  const now = new Date();
  await db.collection(COLLECTION).updateOne(
    { _id: reservation._id, reservationStatus: "pending_payment" },
    {
      $set: {
        reservationStatus: "cancelled",
        cancelledBy: "system",
        cancelReason,
        mpPaymentId: paymentIdStr,
        mpPaymentStatusLast: "approved",
        paymentStatus: "approved",
        updatedAt: now,
      },
      $unset: { checkoutToken: "" },
    },
  );
  const latest = (await findReservationByHexId(db, reservation._id.toHexString())) ?? reservation;
  return refundApprovedPaymentAndMark(db, latest, paymentIdStr);
}

/**
 * Confirma la reserva si el pago está approved y el external_reference coincide.
 * Idempotente: si ya está confirmed con el mismo mpPaymentId, no hace nada destructivo.
 * Si el cupo ya lo tomó otra (pago más rápido o turno del panel), no confirma y reembolsa.
 */
export async function tryConfirmReservationFromMpPayment(
  db: Db,
  payment: MpPaymentPayload,
): Promise<{ outcome: "confirmed" | "ignored" | "no_match" | "not_approved"; detail?: string }> {
  const paymentIdStr = String(payment.id);
  const ext = payment.external_reference?.trim() ?? "";

  if (payment.status !== "approved") {
    if (ext) {
      const res = await findReservationByHexId(db, ext);
      if (res && res.reservationStatus === "pending_payment") {
        await db.collection(COLLECTION).updateOne(
          { _id: res._id },
          {
            $set: {
              mpPaymentId: paymentIdStr,
              mpPaymentStatusLast: payment.status,
              updatedAt: new Date(),
            },
          },
        );
      }
    }
    return { outcome: "not_approved", detail: payment.status };
  }

  if (!ext) {
    return { outcome: "no_match", detail: "missing_external_reference" };
  }

  const reservation = await findReservationByHexId(db, ext);
  if (!reservation) {
    return { outcome: "no_match", detail: "reservation_not_found" };
  }

  if (reservation.reservationStatus === "confirmed") {
    if (reservation.mpPaymentId === paymentIdStr) {
      return { outcome: "ignored", detail: "already_confirmed_same_payment" };
    }
    return { outcome: "ignored", detail: "already_confirmed_different_payment" };
  }

  if (reservation.reservationStatus !== "pending_payment") {
    if (reservation.reservationStatus === "cancelled" && reservation.paymentStatus !== "refunded") {
      const refunded = await refundApprovedPaymentAndMark(db, reservation, paymentIdStr);
      return {
        outcome: "ignored",
        detail: refunded
          ? `reservation_status_cancelled_refunded`
          : `reservation_status_cancelled_refund_failed`,
      };
    }
    return { outcome: "ignored", detail: `reservation_status_${reservation.reservationStatus}` };
  }

  if (reservation.paymentDeadlineAt && reservation.paymentDeadlineAt.getTime() < Date.now()) {
    const refunded = await releasePendingAfterUnusablePayment(
      db,
      reservation,
      paymentIdStr,
      "payment_deadline_expired",
    );
    return { outcome: "ignored", detail: refunded ? "reservation_expired_refunded" : "reservation_expired_refund_failed" };
  }

  const durationMinutes = reservationDurationMinutesFromDoc(reservation);
  const interval = slotIntervalMs(reservation.dateKey, reservation.timeLocal, durationMinutes);
  if (!interval) {
    const refunded = await releasePendingAfterUnusablePayment(db, reservation, paymentIdStr, "invalid_slot_on_payment");
    return { outcome: "ignored", detail: refunded ? "invalid_slot_refunded" : "invalid_slot_refund_failed" };
  }

  const capGetter = await buildCapGetterForDate(db, reservation.dateKey);
  const seatTaken = await reservationWouldExceedSalonCapacity(
    db,
    reservation.dateKey,
    interval,
    capGetter,
    reservation._id,
    "confirmed",
  );
  if (seatTaken) {
    const refunded = await releasePendingAfterUnusablePayment(db, reservation, paymentIdStr, "slot_taken_on_payment");
    return { outcome: "ignored", detail: refunded ? "slot_taken_refunded" : "slot_taken_refund_failed" };
  }

  const now = new Date();
  const result = await db.collection(COLLECTION).updateOne(
    {
      _id: reservation._id,
      reservationStatus: "pending_payment",
    },
    {
      $set: {
        reservationStatus: "confirmed",
        paymentStatus: "approved",
        mpPaymentId: paymentIdStr,
        mpPaymentStatusLast: payment.status,
        mpPaymentApprovedAt: now,
        updatedAt: now,
      },
      $unset: { checkoutToken: "" },
    },
  );

  if (result.modifiedCount !== 1) {
    const again = await findReservationByHexId(db, reservation._id.toHexString());
    if (again?.reservationStatus === "confirmed" && again.mpPaymentId === paymentIdStr) {
      return { outcome: "ignored", detail: "already_confirmed_same_payment" };
    }
    if (again && again.reservationStatus !== "confirmed" && again.paymentStatus !== "refunded") {
      const refunded = await refundApprovedPaymentAndMark(db, again, paymentIdStr);
      return {
        outcome: "ignored",
        detail: refunded ? "concurrent_update_refunded" : "concurrent_update_refund_failed",
      };
    }
    return { outcome: "ignored", detail: "concurrent_update" };
  }

  const confirmedRows = await loadConfirmedCapacityRows(db, reservation.dateKey);
  if (!selfKeepsConfirmedSeat(reservation.dateKey, reservation._id, interval, now.getTime(), confirmedRows, capGetter)) {
    await db.collection(COLLECTION).updateOne(
      { _id: reservation._id, reservationStatus: "confirmed", mpPaymentId: paymentIdStr },
      {
        $set: {
          reservationStatus: "cancelled",
          cancelledBy: "system",
          cancelReason: "slot_taken_on_payment",
          updatedAt: new Date(),
        },
      },
    );
    const latest = (await findReservationByHexId(db, reservation._id.toHexString())) ?? reservation;
    const refunded = await refundApprovedPaymentAndMark(db, latest, paymentIdStr);
    return { outcome: "ignored", detail: refunded ? "slot_taken_race_refunded" : "slot_taken_race_refund_failed" };
  }

  return { outcome: "confirmed" };
}

export async function insertMpWebhookEvent(db: Db, doc: MpWebhookEventDoc): Promise<ObjectId> {
  const r = await db.collection<MpWebhookEventDoc>(WEBHOOK_LOGS).insertOne(doc);
  return r.insertedId;
}

export async function updateMpWebhookEvent(
  db: Db,
  id: ObjectId,
  patch: Partial<Pick<MpWebhookEventDoc, "processingOutcome" | "detail" | "reservationHexId" | "mpPaymentId">>,
) {
  await db.collection(WEBHOOK_LOGS).updateOne({ _id: id }, { $set: patch });
}

/** Marca reservas pending_payment vencidas como canceladas (el cupo ya se libera al vencer paymentDeadlineAt). */
export async function expirePendingReservations(db: Db): Promise<number> {
  const now = new Date();
  const r = await db.collection(COLLECTION).updateMany(
    {
      reservationStatus: "pending_payment",
      paymentDeadlineAt: { $lt: now },
    },
    {
      $set: {
        reservationStatus: "cancelled",
        paymentStatus: "failed",
        cancelReason: "payment_deadline_expired",
        updatedAt: now,
      },
      $unset: { checkoutToken: "" },
    },
  );
  return r.modifiedCount;
}

const TECHNICAL_NOTE_MAX = 4000;

/** Guarda o borra la ficha técnica de una visita (solo panel). */
export async function setReservationTechnicalNote(
  db: Db,
  reservationHexId: string,
  note: string,
): Promise<{ ok: true } | { error: string; code?: string }> {
  const hex = reservationHexId.trim();
  const doc = await findReservationByHexId(db, hex);
  if (!doc) {
    return { error: "Turno no encontrado.", code: "NOT_FOUND" };
  }

  const trimmed = note.trim();
  if (trimmed.length > TECHNICAL_NOTE_MAX) {
    return { error: `La nota no puede superar ${TECHNICAL_NOTE_MAX} caracteres.`, code: "TOO_LONG" };
  }

  const now = new Date();
  await db.collection<ReservationDoc>(COLLECTION).updateOne(
    { _id: doc._id },
    {
      $set: {
        technicalNote: trimmed.length > 0 ? trimmed : null,
        updatedAt: now,
      },
    },
  );

  return { ok: true };
}
