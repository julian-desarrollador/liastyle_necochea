import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { listClientsSummary } from "@/lib/reservations/admin-queries";
import { ensureReservationIndexes } from "@/lib/reservations/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit == null || rawLimit.trim() === "" ? Number.NaN : Number(rawLimit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(200, Math.max(1, Math.trunc(parsedLimit)))
    : 80;

  try {
    const db = await getDb();
    await ensureReservationIndexes(db);
    const clients = await listClientsSummary(db, { q, limit });
    return NextResponse.json({ clients });
  } catch (e) {
    console.error("[api/panel-turnos/clientes GET]", e);
    return NextResponse.json({ error: "No se pudieron cargar las clientas." }, { status: 500 });
  }
}
