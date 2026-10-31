import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  deleteAgendaBlockByHexId,
  deleteAgendaBlocksByGroupId,
  insertAgendaBlocks,
  type AgendaBlockScope,
  type InsertAgendaBlockInput,
} from "@/lib/booking/agenda-blocks";
import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";

export const dynamic = "force-dynamic";

function parseScope(v: unknown): AgendaBlockScope | null {
  if (v === "salon" || v === "chair_1" || v === "chair_2") return v;
  return null;
}

/** Convierte un objeto del body en input de bloqueo, o devuelve un mensaje de error. */
function parseBlockInput(raw: unknown, groupId: string | null): InsertAgendaBlockInput | string {
  if (!raw || typeof raw !== "object") return "Cuerpo inválido.";
  const b = raw as Record<string, unknown>;

  const anchorDateKey = typeof b.anchorDateKey === "string" ? b.anchorDateKey.trim() : "";
  const timeLocal = typeof b.timeLocal === "string" ? b.timeLocal.trim() : "";
  const durationMinutes = Number(b.durationMinutes);
  const scope = parseScope(b.scope);
  const notes = typeof b.notes === "string" ? b.notes : null;

  const recurrenceType = typeof b.recurrenceType === "string" ? b.recurrenceType.trim() : "once";
  const untilDateKey =
    typeof b.untilDateKey === "string" && b.untilDateKey.trim() ? b.untilDateKey.trim() : null;

  if (!anchorDateKey || !timeLocal || !scope) return "Faltan datos obligatorios.";

  let recurrence: InsertAgendaBlockInput["recurrence"] = null;
  if (recurrenceType === "weekly") {
    recurrence = { type: "weekly", untilDateKey };
  } else if (recurrenceType !== "once") {
    return "Tipo de recurrencia inválido.";
  }

  return { anchorDateKey, timeLocal, durationMinutes, scope, recurrence, notes, groupId };
}

/**
 * Body: un bloqueo (`{ anchorDateKey, timeLocal, ... }`) o varios (`{ blocks: [...], groupId? }`).
 * Con varios, se validan todos y se guardan juntos.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const groupId = typeof b.groupId === "string" && b.groupId.trim() ? b.groupId.trim() : null;
  const rawBlocks = Array.isArray(b.blocks) ? b.blocks : [b];

  const inputs: InsertAgendaBlockInput[] = [];
  for (const raw of rawBlocks) {
    const parsed = parseBlockInput(raw, groupId);
    if (typeof parsed === "string") {
      return NextResponse.json({ error: parsed }, { status: 400 });
    }
    inputs.push(parsed);
  }

  try {
    const db = await getDb();
    const result = await insertAgendaBlocks(db, inputs);
    if ("error" in result) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id: result.ids[0], ids: result.ids }, { status: 201 });
  } catch (e) {
    console.error("[panel-turnos agenda-blocks POST]", e);
    return NextResponse.json({ error: "No se pudo crear el bloqueo." }, { status: 500 });
  }
}

/** `?id=` borra un bloqueo; `?groupId=` borra todos los creados juntos. */
export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim() ?? "";
  const groupId = params.get("groupId")?.trim() ?? "";
  if (!id && !groupId) {
    return NextResponse.json({ error: "Falta el id." }, { status: 400 });
  }

  try {
    const db = await getDb();
    if (groupId) {
      const n = await deleteAgendaBlocksByGroupId(db, groupId);
      if (n === 0) {
        return NextResponse.json({ error: "Bloqueo no encontrado." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, deleted: n });
    }
    const ok = await deleteAgendaBlockByHexId(db, id);
    if (!ok) {
      return NextResponse.json({ error: "Bloqueo no encontrado." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (e) {
    console.error("[panel-turnos agenda-blocks DELETE]", e);
    return NextResponse.json({ error: "No se pudo eliminar." }, { status: 500 });
  }
}
