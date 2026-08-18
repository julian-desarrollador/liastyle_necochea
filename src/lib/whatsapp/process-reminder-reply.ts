import type { Db } from "mongodb";

import {
  canonicalPhoneDigitsAR,
  customerPhoneDigitsQueryValues,
} from "@/lib/customer/phone-canonical-ar";
import {
  cancelReservation,
  confirmAttendanceViaWhatsApp,
} from "@/lib/reservations/service";
import type { ReservationDoc } from "@/lib/reservations/types";
import { CUSTOMER_CANCEL_MIN_HOURS } from "@/lib/reservations/cancel-policy";
import { SALON_WHATSAPP_DISPLAY } from "@/lib/salon-contact";

import type { WaReminderInboundAction } from "./parse-inbound-action";
import { whatsAppFromToDigits } from "./twilio-phone";

const COLLECTION = "reservations";

function bookingUrl(): string | null {
  const base =
    process.env.APP_BASE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
  return base ? `${base.replace(/\/$/, "")}/turnos` : null;
}

async function findReservationForInboundReply(
  db: Db,
  input: { originalMessageSid?: string | null; now: Date },
): Promise<ReservationDoc | null> {
  const originalSid = input.originalMessageSid?.trim();
  if (!originalSid) return null;

  return db.collection<ReservationDoc>(COLLECTION).findOne({
    waReminder24hMessageSid: originalSid,
    waReminder24hStatus: "sent",
    reservationStatus: { $in: ["confirmed", "pending_payment"] },
    startsAt: { $gte: input.now },
  });
}

export type ProcessReminderReplyResult =
  | {
      ok: true;
      action: WaReminderInboundAction;
      reservationId: string;
      replyText: string;
    }
  | {
      ok: false;
      reason: string;
      reservationId?: string;
      replyText?: string;
    };

export async function processWaReminderInboundReply(
  db: Db,
  input: {
    action: WaReminderInboundAction;
    fromWhatsApp: string;
    originalMessageSid?: string | null;
    now?: Date;
  },
): Promise<ProcessReminderReplyResult> {
  const now = input.now ?? new Date();
  const originalSid = input.originalMessageSid?.trim();
  if (!originalSid) {
    return { ok: false, reason: "missing_reply_context" };
  }
  const inboundCanonical = canonicalPhoneDigitsAR(
    whatsAppFromToDigits(input.fromWhatsApp),
  );
  if (!inboundCanonical) {
    return { ok: false, reason: "invalid_phone" };
  }

  const reservation = await findReservationForInboundReply(db, {
    originalMessageSid: originalSid,
    now,
  });
  if (!reservation) {
    return { ok: false, reason: "reservation_not_found" };
  }

  const reservationId = reservation._id.toHexString();
  const reservationPhone =
    reservation.customerPhoneDigits ??
    canonicalPhoneDigitsAR(reservation.customerPhone);
  if (!customerPhoneDigitsQueryValues(inboundCanonical).includes(reservationPhone)) {
    return { ok: false, reason: "phone_mismatch", reservationId };
  }

  const displayDate = reservation.displayDate || reservation.dateKey;
  const time = reservation.timeLocal;

  if (input.action === "cancel") {
    const cancelled = await cancelReservation(db, {
      reservationHexId: reservationId,
      now,
      actor: "whatsapp",
      customerCanonicalDigits: inboundCanonical,
      expectedReminderSid: originalSid,
      cancelReason: "Cancelado desde WhatsApp (recordatorio)",
    });

    if (!("ok" in cancelled)) {
      if (cancelled.code === "TOO_LATE") {
        return {
          ok: false,
          reason: "cancel_too_late",
          reservationId,
          replyText:
            `Ya no podemos cancelar automáticamente: faltan menos de ${CUSTOMER_CANCEL_MIN_HOURS} h. ` +
            `Si abonaste una seña, se pierde. Comunicate con Lia Style al ${SALON_WHATSAPP_DISPLAY}.`,
        };
      }
      return {
        ok: false,
        reason: "cancel_failed",
        reservationId,
        replyText: `No pudimos cancelar el turno. Comunicate con Lia Style al ${SALON_WHATSAPP_DISPLAY}.`,
      };
    }

    return {
      ok: true,
      action: input.action,
      reservationId,
      replyText:
        `Listo, cancelamos tu turno del ${displayDate} a las ${time}.` +
        (bookingUrl() ? ` Para reservar otro día entrá a ${bookingUrl()}` : ""),
    };
  }

  const confirmed = await confirmAttendanceViaWhatsApp(db, {
    reservationHexId: reservationId,
    expectedReminderSid: originalSid,
    now,
  });
  if (!("ok" in confirmed)) {
    return {
      ok: false,
      reason: "confirm_failed",
      reservationId,
      replyText: `No pudimos registrar tu confirmación. Comunicate con Lia Style al ${SALON_WHATSAPP_DISPLAY}.`,
    };
  }

  const name = reservation.customerName?.trim() || "Hola";
  return {
    ok: true,
    action: input.action,
    reservationId,
    replyText:
      `¡Perfecto, ${name}! Te esperamos el ${displayDate} a las ${time} ` +
      "en Lia Style (Av. 91 1534, Necochea).",
  };
}
