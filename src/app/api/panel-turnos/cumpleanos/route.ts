import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { listUpcomingBirthdays } from "@/lib/vip/customer-profiles";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const db = await getDb();
    const birthdays = await listUpcomingBirthdays(db);
    return NextResponse.json({ birthdays });
  } catch (e) {
    console.error("[api/panel-turnos/cumpleanos GET]", e);
    return NextResponse.json({ error: "No se pudieron cargar los cumpleaños." }, { status: 500 });
  }
}
