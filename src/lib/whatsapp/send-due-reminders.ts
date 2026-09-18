import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ObjectId, type Db, type Filter } from "mongodb";

import { canonicalPhoneDigitsAR } from "@/lib/customer/phone-canonical-ar";
import type { ReservationDoc } from "@/lib/reservations/types";
import { buildTwilioWhatsAppSendParams, getTwilioClient } from "@/lib/twilio";
import { getVipStatusMapForPhones } from "@/lib/whatsapp/reminder-audience";
import { buildReminderContentVariables } from "@/lib/whatsapp/reminder-content-variables";
import { normalizeToWhatsAppE164 } from "@/lib/whatsapp/twilio-phone";
import {
  ensureWhatsappLogIndexes,
  insertWhatsappOutboundLog,
} from "@/lib/whatsapp/whatsapp-logs";

const TZ = "America/Argentina/Buenos_Aires";
const COLLECTION = "reservations";
/** No mandar si el turno está a menos de 90 minutos. */
export const REMINDER_MIN_LEAD_MS = 90 * 60 * 1000;

const ELIGIBLE_PAYMENT = ["approved", "not_required"] as const;

export type SendDueRemindersResult = {
  todayKey: string;
  tomorrowKey: string;
  candidates: number;
  sent: number;
  sentNew: number;
  sentVip: number;
  errors: number;
  ambiguousErrors: number;
  logErrors: number;
};

function isDefinitiveTwilioFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRateLimitRetry(
  client: ReturnType<typeof getTwilioClient>,
  params: Record<string, unknown>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.messages.create(params);
    } catch (error) {
      lastError = error;
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: unknown }).status)
          : 0;
      if (status !== 429 || attempt === 2) throw error;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

export function buildDueReminderWindow(now = new Date()): {
  todayKey: string;
  tomorrowKey: string;
  minStartsAt: Date;
  endUtc: Date;
} {
  const todayKey = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const noonTodayArt = fromZonedTime(`${todayKey}T12:00:00`, TZ);
  const tomorrowKey = formatInTimeZone(addDays(noonTodayArt, 1), TZ, "yyyy-MM-dd");
  const minStartsAt = new Date(now.getTime() + REMINDER_MIN_LEAD_MS);
  const endUtc = fromZonedTime(`${tomorrowKey}T23:59:59.999`, TZ);
  return { todayKey, tomorrowKey, minStartsAt, endUtc };
}

function parseObjectId(hex: string): ObjectId | null {
  const t = hex.trim();
  if (!ObjectId.isValid(t)) return null;
  try {
    return new ObjectId(t);
  } catch {
    return null;
  }
}

/**
 * Envía recordatorios 24h a turnos confirmados de hoy (aún con margen) y de mañana.
 * Si `reservationIds` está definido, se limita a esos ids (alta / botón del panel).
 */
export async function sendDueReminders(
  db: Db,
  opts?: { now?: Date; reservationIds?: string[] },
): Promise<SendDueRemindersResult> {
  const now = opts?.now ?? new Date();
  const { todayKey, tomorrowKey, minStartsAt, endUtc } = buildDueReminderWindow(now);

  const newContentSid = process.env.TWILIO_REMINDER_NEW_CONTENT_SID?.trim();
  const vipContentSid = process.env.TWILIO_REMINDER_VIP_CONTENT_SID?.trim();
  if (!newContentSid) {
    throw new Error("Falta variable de entorno: TWILIO_REMINDER_NEW_CONTENT_SID");
  }
  if (!vipContentSid) {
    throw new Error("Falta variable de entorno: TWILIO_REMINDER_VIP_CONTENT_SID");
  }

  const empty: SendDueRemindersResult = {
    todayKey,
    tomorrowKey,
    candidates: 0,
    sent: 0,
    sentNew: 0,
    sentVip: 0,
    errors: 0,
    ambiguousErrors: 0,
    logErrors: 0,
  };

  const idFilter = (() => {
    if (!opts?.reservationIds) return null;
    const oids = opts.reservationIds.map(parseObjectId).filter((id): id is ObjectId => Boolean(id));
    return oids;
  })();
  if (opts?.reservationIds && (!idFilter || idFilter.length === 0)) {
    return empty;
  }

  const client = getTwilioClient();
  const sendParams = await buildTwilioWhatsAppSendParams(client);
  const reservationsCol = db.collection<ReservationDoc>(COLLECTION);
  await ensureWhatsappLogIndexes(db);

  const query: Record<string, unknown> = {
    startsAt: { $gte: minStartsAt, $lte: endUtc },
    reservationStatus: "confirmed",
    paymentStatus: { $in: [...ELIGIBLE_PAYMENT] },
    whatsappOptIn: true,
    waReminder24hSentAt: null,
    customerPhone: { $exists: true, $nin: [null, ""] },
  };
  if (idFilter) query._id = { $in: idFilter };

  const reservations = await reservationsCol.find(query).toArray();

  const phoneDigitsByReservation = new Map<string, string>();
  for (const reservation of reservations) {
    const canonical =
      canonicalPhoneDigitsAR(reservation.customerPhoneDigits ?? "") ||
      canonicalPhoneDigitsAR(reservation.customerPhone ?? "");
    if (canonical.startsWith("549") && canonical.length >= 11) {
      phoneDigitsByReservation.set(reservation._id.toHexString(), canonical);
    }
  }
  const vipStatusByPhone = await getVipStatusMapForPhones(
    db,
    [...new Set(phoneDigitsByReservation.values())],
    now,
  );

  let sent = 0;
  let sentNew = 0;
  let sentVip = 0;
  let errors = 0;
  let logErrors = 0;
  let ambiguousErrors = 0;

  for (const reservation of reservations) {
    const reservationId = reservation._id.toHexString();
    const canonical = phoneDigitsByReservation.get(reservationId);
    if (!canonical) {
      errors += 1;
      try {
        await insertWhatsappOutboundLog(db, {
          reservationId,
          to: reservation.customerPhone ?? "",
          sid: null,
          status: "failed",
          template: newContentSid,
          error: "Teléfono inválido para clasificar o enviar.",
        });
      } catch (logError) {
        logErrors += 1;
        console.error("[send-due-reminders] no se pudo guardar teléfono inválido", {
          reservationId,
          error: logError instanceof Error ? logError.message : "Error desconocido",
        });
      }
      continue;
    }

    const isVip = Boolean(vipStatusByPhone.get(canonical)?.isVip);
    const contentSid = isVip ? vipContentSid : newContentSid;

    let contentVariablesJson: string;
    let templateVariables: Record<string, string>;
    let toWhatsApp: string;
    try {
      const nombre = reservation.customerName ?? "";
      const servicio = reservation.treatmentName ?? "";
      const hora =
        typeof reservation.timeLocal === "string" && /^\d{2}:\d{2}$/.test(reservation.timeLocal)
          ? reservation.timeLocal
          : formatInTimeZone(reservation.startsAt, TZ, "HH:mm");
      const built = buildReminderContentVariables({
        nombre,
        servicio,
        startsAt: reservation.startsAt,
        hora,
      });
      contentVariablesJson = built.contentVariablesJson;
      templateVariables = built.templateVariables;
      toWhatsApp = normalizeToWhatsAppE164(reservation.customerPhone);
    } catch (preparationError) {
      errors += 1;
      console.error("[send-due-reminders] datos inválidos", {
        reservationId,
        error: preparationError instanceof Error ? preparationError.message : "Error desconocido",
      });
      continue;
    }

    const claimedAt = new Date();
    const claim = await reservationsCol.findOneAndUpdate(
      {
        _id: reservation._id,
        reservationStatus: "confirmed",
        paymentStatus: { $in: [...ELIGIBLE_PAYMENT] },
        whatsappOptIn: true,
        waReminder24hSentAt: null,
        customerPhone: { $exists: true, $nin: [null, ""] },
      } as Filter<ReservationDoc>,
      {
        $set: {
          waReminder24hSentAt: claimedAt,
          waReminder24hStatus: "sending",
        },
        $unset: { waReminder24hMessageSid: "" },
      },
      { returnDocument: "before" },
    );

    if (!claim) {
      continue;
    }

    let twilioResponse: { sid: string; status?: string };
    try {
      twilioResponse = await sendWithRateLimitRetry(client, {
        ...sendParams,
        to: toWhatsApp,
        contentSid,
        contentVariables: contentVariablesJson,
      });
    } catch (error) {
      errors += 1;
      const definitive = isDefinitiveTwilioFailure(error);
      if (definitive) {
        await reservationsCol.updateOne(
          { _id: reservation._id, waReminder24hSentAt: claimedAt },
          {
            $set: { waReminder24hSentAt: null },
            $unset: {
              waReminder24hMessageSid: "",
              waReminder24hStatus: "",
            },
          },
        );
      } else {
        ambiguousErrors += 1;
        await reservationsCol.updateOne(
          { _id: reservation._id, waReminder24hSentAt: claimedAt },
          {
            $set: { waReminder24hStatus: "unknown" },
            $unset: { waReminder24hMessageSid: "" },
          },
        );
      }
      try {
        await insertWhatsappOutboundLog(db, {
          reservationId,
          to: reservation.customerPhone ?? "",
          sid: null,
          status: definitive ? "failed" : "unknown",
          template: contentSid,
          templateVariables,
          error: error instanceof Error ? error.message : "Error desconocido",
        });
      } catch (logError) {
        logErrors += 1;
        console.error("[send-due-reminders] no se pudo guardar el error", {
          reservationId,
          error: logError instanceof Error ? logError.message : "Error desconocido",
        });
      }
      continue;
    }

    sent += 1;
    if (isVip) sentVip += 1;
    else sentNew += 1;
    let stateAssociated = false;
    let stateError: unknown = null;
    for (let attempt = 0; attempt < 3 && !stateAssociated; attempt += 1) {
      try {
        const stateUpdated = await reservationsCol.updateOne(
          { _id: reservation._id, waReminder24hSentAt: claimedAt },
          {
            $set: {
              waReminder24hMessageSid: twilioResponse.sid,
              waReminder24hStatus: "sent",
            },
          },
        );
        if (stateUpdated.modifiedCount !== 1) {
          throw new Error("La reserva cambió después del envío.");
        }
        stateAssociated = true;
      } catch (error) {
        stateError = error;
        if (attempt < 2) await sleep(250 * 2 ** attempt);
      }
    }
    if (!stateAssociated) {
      logErrors += 1;
      console.error("[send-due-reminders] enviado pero no se pudo asociar el SID", {
        reservationId,
        sid: twilioResponse.sid,
        error: stateError instanceof Error ? stateError.message : "Error desconocido",
      });
    }
    try {
      await insertWhatsappOutboundLog(db, {
        reservationId,
        to: reservation.customerPhone,
        sid: twilioResponse.sid,
        status: twilioResponse.status ?? "sent",
        template: contentSid,
        templateVariables,
      });
    } catch (error) {
      logErrors += 1;
      console.error("[send-due-reminders] mensaje enviado pero no se pudo guardar el log", {
        reservationId,
        error: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }

  return {
    todayKey,
    tomorrowKey,
    candidates: reservations.length,
    sent,
    sentNew,
    sentVip,
    errors,
    ambiguousErrors,
    logErrors,
  };
}

/** No bloquea el alta del turno si Twilio falla. */
export function scheduleDueReminderSend(db: Db, reservationId: string): void {
  void sendDueReminders(db, { reservationIds: [reservationId] }).catch((error) => {
    console.error("[send-due-reminders] post-confirm", {
      reservationId,
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  });
}
