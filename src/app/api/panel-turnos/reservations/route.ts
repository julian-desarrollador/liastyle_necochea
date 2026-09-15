import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { listAgendaBlocksForCalendarMonth, type SalonAgendaBlockDoc } from "@/lib/booking/agenda-blocks";
import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { listReservationsForCalendarMonth } from "@/lib/reservations/admin-queries";
import type { ReservationDoc } from "@/lib/reservations/types";

function serialize(r: ReservationDoc) {
  return {
    id: r._id.toHexString(),
    treatmentId: r.treatmentId,
    treatmentName: r.treatmentName,
    subtitle: r.subtitle,
    category: r.category,
    dateKey: r.dateKey,
    timeLocal: r.timeLocal,
    displayDate: r.displayDate,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    reservationStatus: r.reservationStatus,
    paymentStatus: r.paymentStatus,
    cancelledBy: r.cancelledBy ?? null,
    source: r.source ?? "app_turnos",
    externalReference: r.externalReference ?? null,
    preferenceId: r.preferenceId ?? null,
    mpPaymentId: r.mpPaymentId ?? null,
    mpPaymentStatusLast: r.mpPaymentStatusLast ?? null,
    mpPaymentApprovedAt:
      r.mpPaymentApprovedAt instanceof Date
        ? r.mpPaymentApprovedAt.toISOString()
        : r.mpPaymentApprovedAt
          ? String(r.mpPaymentApprovedAt)
          : null,
    paymentDeadlineAt:
      r.paymentDeadlineAt instanceof Date
        ? r.paymentDeadlineAt.toISOString()
        : r.paymentDeadlineAt
          ? String(r.paymentDeadlineAt)
          : null,
    waReminder24hSentAt:
      r.waReminder24hSentAt instanceof Date
        ? r.waReminder24hSentAt.toISOString()
        : r.waReminder24hSentAt
          ? String(r.waReminder24hSentAt)
          : null,
    waReminder24hStatus: r.waReminder24hStatus ?? null,
    waAttendanceConfirmedAt:
      r.waAttendanceConfirmedAt instanceof Date
        ? r.waAttendanceConfirmedAt.toISOString()
        : r.waAttendanceConfirmedAt
          ? String(r.waAttendanceConfirmedAt)
          : null,
    startsAt: r.startsAt instanceof Date ? r.startsAt.toISOString() : String(r.startsAt),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

function serializeAgendaBlock(b: SalonAgendaBlockDoc) {
  return {
    id: b._id.toHexString(),
    anchorDateKey: b.anchorDateKey,
    timeLocal: b.timeLocal,
    durationMinutes: b.durationMinutes,
    scope: b.scope,
    recurrence: b.recurrence ?? null,
    notes: b.notes ?? null,
  };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const y = Number(url.searchParams.get("year"));
  const m = Number(url.searchParams.get("month"));
  if (!Number.isFinite(y) || y < 2000 || y > 2100 || !Number.isFinite(m) || m < 1 || m > 12) {
    return NextResponse.json({ error: "Año o mes inválido." }, { status: 400 });
  }

  try {
    const db = await getDb();
    const [list, blocks] = await Promise.all([
      listReservationsForCalendarMonth(db, y, m),
      listAgendaBlocksForCalendarMonth(db, y, m),
    ]);
    return NextResponse.json({
      reservations: list.map(serialize),
      agendaBlocks: blocks.map(serializeAgendaBlock),
    });
  } catch (e) {
    console.error("[panel-turnos reservations GET]", e);
    return NextResponse.json({ error: "No se pudieron cargar las reservas." }, { status: 500 });
  }
}
