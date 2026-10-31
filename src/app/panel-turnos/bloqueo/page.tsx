import { formatInTimeZone } from "date-fns-tz";
import { cookies } from "next/headers";

import { nextOpenDateKey } from "@/lib/booking/agenda-block-ui";
import { getAvailableTimesForDate } from "@/lib/booking/salon-availability";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";

import { PanelLogin } from "../panel-login";
import { PanelBloqueoAgendaClient } from "./panel-bloqueo-agenda-client";

function todayKey() {
  return formatInTimeZone(new Date(), "America/Argentina/Buenos_Aires", "yyyy-MM-dd");
}

export default async function PanelBloqueoAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return <PanelLogin />;
  }

  const params = await searchParams;
  const raw = Array.isArray(params.fecha) ? params.fecha[0] : params.fecha;
  // Si viene un día del panel y está abierto, arrancamos ahí; si no, el próximo día abierto.
  const initialDateKey =
    raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && getAvailableTimesForDate(raw).length > 0
      ? raw
      : nextOpenDateKey(todayKey());

  return <PanelBloqueoAgendaClient initialDateKey={initialDateKey} />;
}
