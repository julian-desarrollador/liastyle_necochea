import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { removePanelSubscription, savePanelSubscription } from "@/lib/push/panel-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PushBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

function readPushBody(body: PushBody): { endpoint: string; p256dh: string; auth: string } | null {
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth.trim() : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 2000) return null;
  if (!p256dh || p256dh.length > 200 || !auth || auth.length > 200) return null;
  return { endpoint, p256dh, auth };
}

async function authorized(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value);
}

export async function POST(request: Request) {
  if (!(await authorized())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  let body: PushBody;
  try {
    body = (await request.json()) as PushBody;
  } catch {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const parsed = readPushBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "Suscripción inválida." }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;
  try {
    const db = await getDb();
    await savePanelSubscription(db, {
      endpoint: parsed.endpoint,
      keys: { p256dh: parsed.p256dh, auth: parsed.auth },
      userAgent,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[panel-push] subscribe", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No se pudo guardar el aviso." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await authorized())) {
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
    await removePanelSubscription(db, endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[panel-push] unsubscribe", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "No se pudo desactivar el aviso." }, { status: 500 });
  }
}
