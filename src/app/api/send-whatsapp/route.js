import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { buildTwilioWhatsAppSendParams, getTwilioClient } from "@/lib/twilio";
import { buildReminderContentVariablesFromValues } from "@/lib/whatsapp/reminder-content-variables";
import { normalizeToWhatsAppE164 } from "@/lib/whatsapp/twilio-phone";
import { insertWhatsappOutboundLog } from "@/lib/whatsapp/whatsapp-logs";

function methodNotAllowed() {
  return NextResponse.json({ error: "Método no permitido" }, { status: 405 });
}

export function GET() {
  return methodNotAllowed();
}

export function PUT() {
  return methodNotAllowed();
}

export function PATCH() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}

export function OPTIONS() {
  return methodNotAllowed();
}

export async function POST(request) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  let to = "";
  let nombre = "";
  let servicio = "";
  let fecha = "";
  let hora = "";

  try {
    const body = await request.json();
    to = body?.to ?? "";
    nombre = body?.nombre ?? "";
    servicio = body?.servicio ?? "";
    fecha = body?.fecha ?? "";
    hora = body?.hora ?? "";

    if (!to || !nombre || !servicio || !fecha || !hora) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: to, nombre, servicio, fecha, hora" },
        { status: 500 },
      );
    }

    const contentSid = process.env.TWILIO_REMINDER_NEW_CONTENT_SID?.trim();
    if (!contentSid) {
      throw new Error("Falta variable de entorno: TWILIO_REMINDER_NEW_CONTENT_SID");
    }

    const client = getTwilioClient();
    const sendParams = await buildTwilioWhatsAppSendParams(client);
    const { contentVariablesJson, templateVariables } =
      buildReminderContentVariablesFromValues({ nombre, servicio, fecha, hora });
    const response = await client.messages.create({
      ...sendParams,
      to: normalizeToWhatsAppE164(to),
      contentSid,
      contentVariables: contentVariablesJson,
    });

    try {
      const db = await getDb();
      await insertWhatsappOutboundLog(db, {
        reservationId: "manual",
        to: String(to),
        sid: response.sid,
        status: response.status,
        template: contentSid,
        templateVariables,
      });
    } catch (logError) {
      console.error("[api/send-whatsapp] enviado sin log", logError);
      return NextResponse.json({
        success: true,
        sid: response.sid,
        logged: false,
      });
    }

    return NextResponse.json({ success: true, sid: response.sid, logged: true });
  } catch (error) {
    try {
      if (to) {
        const db = await getDb();
        await insertWhatsappOutboundLog(db, {
          reservationId: "manual",
          to: String(to),
          sid: null,
          status: "failed",
          template: process.env.TWILIO_REMINDER_NEW_CONTENT_SID ?? null,
          templateVariables: { nombre, servicio, fecha, hora },
          error: error instanceof Error ? error.message : "Error desconocido",
        });
      }
    } catch {
      // no-op
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo enviar WhatsApp" },
      { status: 500 },
    );
  }
}
