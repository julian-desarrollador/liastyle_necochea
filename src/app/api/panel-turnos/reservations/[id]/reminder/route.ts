import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { ensureReservationIndexes, findReservationByHexId } from "@/lib/reservations/service";
import { sendDueReminders } from "@/lib/whatsapp/send-due-reminders";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const hex = id.trim();

  try {
    const db = await getDb();
    await ensureReservationIndexes(db);
    const doc = await findReservationByHexId(db, hex);
    if (!doc) {
      return NextResponse.json({ error: "Turno no encontrado." }, { status: 404 });
    }

    const alreadySent =
      doc.waReminder24hStatus === "sent" || Boolean(doc.waReminder24hMessageSid);
    if (alreadySent) {
      return NextResponse.json({ error: "Este turno ya tiene el recordatorio enviado." }, { status: 409 });
    }

    const result = await sendDueReminders(db, { reservationIds: [hex] });
    if (result.sent >= 1) {
      const latest = await findReservationByHexId(db, hex);
      return NextResponse.json({
        ok: true as const,
        waReminder24hSentAt:
          latest?.waReminder24hSentAt instanceof Date
            ? latest.waReminder24hSentAt.toISOString()
            : latest?.waReminder24hSentAt
              ? String(latest.waReminder24hSentAt)
              : new Date().toISOString(),
        waReminder24hStatus: latest?.waReminder24hStatus ?? "sent",
      });
    }

    if (result.ambiguousErrors >= 1) {
      return NextResponse.json(
        { error: "Twilio no confirmó el envío. El estado quedó incierto; no reenvíes de inmediato." },
        { status: 502 },
      );
    }
    if (result.errors >= 1) {
      return NextResponse.json(
        { error: "No se pudo enviar el WhatsApp. Revisá el número o intentá de nuevo." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        error:
          "Este recordatorio se manda el día anterior o el mismo día, hasta 90 minutos antes del turno.",
      },
      { status: 400 },
    );
  } catch (e) {
    console.error("[api/panel-turnos/reservations/[id]/reminder POST]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo enviar el recordatorio." },
      { status: 500 },
    );
  }
}
