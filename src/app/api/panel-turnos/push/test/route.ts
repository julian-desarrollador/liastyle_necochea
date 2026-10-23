import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { sendPanelPush } from "@/lib/push/panel-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  let endpoint = "";
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  } catch {
    endpoint = "";
  }
  if (!endpoint.startsWith("https://")) {
    return NextResponse.json({ error: "Suscripción inválida." }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await sendPanelPush(
      db,
      {
        title: "Avisos activados en este celular",
        body: "Cuando alguien reserve o cancele, te va a llegar un aviso.",
        url: "/panel-turnos",
      },
      endpoint,
    );
    if (result.sent < 1) {
      return NextResponse.json({ error: "No se pudo enviar el aviso de prueba." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[panel-push] test", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No se pudo enviar el aviso de prueba." }, { status: 500 });
  }
}
