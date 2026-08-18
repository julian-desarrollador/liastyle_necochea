import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { NextResponse } from "next/server";

import { canonicalPhoneDigitsAR } from "@/lib/customer/phone-canonical-ar";
import { getDb } from "@/lib/mongodb";
import { ensureReservationIndexes } from "@/lib/reservations/service";
import { buildTwilioWhatsAppSendParams, getTwilioClient } from "@/lib/twilio";
import { getVipStatusMapForPhones } from "@/lib/whatsapp/reminder-audience";
import { buildReminderContentVariables } from "@/lib/whatsapp/reminder-content-variables";
import { normalizeToWhatsAppE164 } from "@/lib/whatsapp/twilio-phone";
import {
  ensureWhatsappLogIndexes,
  insertWhatsappOutboundLog,
} from "@/lib/whatsapp/whatsapp-logs";

const TZ = "America/Argentina/Buenos_Aires";

function isDefinitiveTwilioFailure(error) {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  const status = Number(error.status);
  return (
    Number.isFinite(status) &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRateLimitRetry(client, params) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.messages.create(params);
    } catch (error) {
      lastError = error;
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number(error.status)
          : 0;
      if (status !== 429 || attempt === 2) throw error;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

function buildTomorrowRangeInArgentina(now = new Date()) {
  const todayKey = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const noonTodayArt = fromZonedTime(`${todayKey}T12:00:00`, TZ);
  const dateKey = formatInTimeZone(addDays(noonTodayArt, 1), TZ, "yyyy-MM-dd");

  const startUtc = fromZonedTime(`${dateKey}T00:00:00.000`, TZ);
  const endUtc = fromZonedTime(`${dateKey}T23:59:59.999`, TZ);

  return { dateKey, startUtc, endUtc };
}

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;

    if (!process.env.CRON_SECRET || authHeader !== expected) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const contentSid = process.env.TWILIO_REMINDER_NEW_CONTENT_SID?.trim();
    if (!contentSid) {
      return NextResponse.json(
        { error: "Falta variable de entorno: TWILIO_REMINDER_NEW_CONTENT_SID" },
        { status: 500 },
      );
    }

    const client = getTwilioClient();
    const sendParams = await buildTwilioWhatsAppSendParams(client);
    const { dateKey, startUtc, endUtc } = buildTomorrowRangeInArgentina();
    console.log(
      `Searching reservations between ${startUtc.toISOString()} and ${endUtc.toISOString()} for dateKey ${dateKey}`,
    );
    const db = await getDb();
    const reservationsCol = db.collection("reservations");
    await Promise.all([ensureReservationIndexes(db), ensureWhatsappLogIndexes(db)]);

    const reservations = await reservationsCol
      .find({
        startsAt: { $gte: startUtc, $lte: endUtc },
        reservationStatus: "confirmed",
        paymentStatus: { $in: ["approved", "not_required"] },
        whatsappOptIn: true,
        waReminder24hSentAt: null,
        customerPhone: { $exists: true, $nin: [null, ""] },
      })
      .toArray();

    const phoneDigitsByReservation = new Map();
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
      new Date(),
    );

    let sent = 0;
    let errors = 0;
    let logErrors = 0;
    let ambiguousErrors = 0;
    let skippedVip = 0;

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
            template: contentSid,
            error: "Teléfono inválido para clasificar o enviar.",
          });
        } catch (logError) {
          logErrors += 1;
          console.error("[daily-reminders] no se pudo guardar teléfono inválido", {
            reservationId,
            error: logError instanceof Error ? logError.message : "Error desconocido",
          });
        }
        continue;
      }

      if (vipStatusByPhone.get(canonical)?.isVip) {
        skippedVip += 1;
        continue;
      }

      let contentVariablesJson;
      let templateVariables;
      let toWhatsApp;
      try {
        const nombre = reservation.customerName ?? "";
        const servicio = reservation.treatmentName ?? "";
        const hora =
          typeof reservation.timeLocal === "string" &&
          /^\d{2}:\d{2}$/.test(reservation.timeLocal)
            ? reservation.timeLocal
            : formatInTimeZone(reservation.startsAt, TZ, "HH:mm");
        ({ contentVariablesJson, templateVariables } =
          buildReminderContentVariables({
            nombre,
            servicio,
            startsAt: reservation.startsAt,
            hora,
          }));
        toWhatsApp = normalizeToWhatsAppE164(reservation.customerPhone);
      } catch (preparationError) {
        errors += 1;
        console.error("[daily-reminders] datos inválidos", {
          reservationId,
          error:
            preparationError instanceof Error
              ? preparationError.message
              : "Error desconocido",
        });
        continue;
      }

      const claimedAt = new Date();
      const claim = await reservationsCol.findOneAndUpdate(
        {
          _id: reservation._id,
          reservationStatus: "confirmed",
          paymentStatus: { $in: ["approved", "not_required"] },
          whatsappOptIn: true,
          waReminder24hSentAt: null,
          customerPhone: { $exists: true, $nin: [null, ""] },
        },
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

      let twilioResponse;
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
          console.error("[daily-reminders] no se pudo guardar el error", {
            reservationId,
            error: logError instanceof Error ? logError.message : "Error desconocido",
          });
        }
        continue;
      }

      sent += 1;
      let stateAssociated = false;
      let stateError = null;
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
        console.error("[daily-reminders] enviado pero no se pudo asociar el SID", {
          reservationId,
          sid: twilioResponse.sid,
          error:
            stateError instanceof Error ? stateError.message : "Error desconocido",
        });
      }
      try {
        await insertWhatsappOutboundLog(db, {
          reservationId,
          to: reservation.customerPhone,
          sid: twilioResponse.sid,
          status: twilioResponse.status,
          template: contentSid,
          templateVariables,
        });
      } catch (error) {
        logErrors += 1;
        console.error("[daily-reminders] mensaje enviado pero no se pudo guardar el log", {
          reservationId,
          error: error instanceof Error ? error.message : "Error desconocido",
        });
      }
    }

    return NextResponse.json({
      dateKey,
      candidates: reservations.length,
      sent,
      skippedVip,
      errors,
      ambiguousErrors,
      logErrors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno del cron" },
      { status: 500 },
    );
  }
}
