import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { computeBookableSlotsDetailed, computeBookableSlotsForTreatmentIdsDetailed } from "@/lib/booking/compute-bookable-slots";
import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { validateServiceCombo } from "@/lib/treatments/booking-rules";
import { findSalonTreatmentById } from "@/lib/treatments/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateKey = url.searchParams.get("dateKey")?.trim() ?? "";
  const treatmentId = url.searchParams.get("treatmentId")?.trim() ?? "";
  const serviceIds = (url.searchParams.get("serviceIds")?.trim() ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const scopeRaw = url.searchParams.get("scope")?.trim().toLowerCase() ?? "public";
  const scope = scopeRaw === "panel" ? "panel" : "public";
  const excludeReservationHexId =
    url.searchParams.get("excludeReservationHexId")?.trim() ??
    url.searchParams.get("excludeReservationId")?.trim() ??
    "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return NextResponse.json({ error: "Fecha invalida." }, { status: 400 });
  }
  if (!treatmentId && serviceIds.length === 0) {
    return NextResponse.json({ error: "Falta el tratamiento." }, { status: 400 });
  }
  if (serviceIds.length > 0) {
    if (serviceIds.length > 4) {
      return NextResponse.json({ error: "Maximo 4 servicios por turno." }, { status: 400 });
    }
    if (serviceIds.some((id) => !findSalonTreatmentById(id))) {
      return NextResponse.json({ error: "Hay servicios invalidos." }, { status: 400 });
    }
    const comboError = validateServiceCombo(serviceIds);
    if (comboError) {
      return NextResponse.json({ error: comboError }, { status: 400 });
    }
  } else if (!findSalonTreatmentById(treatmentId)) {
    return NextResponse.json({ error: "Tratamiento invalido." }, { status: 400 });
  }

  if (scope === "panel") {
    const cookieStore = await cookies();
    if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  } else if (excludeReservationHexId) {
    return NextResponse.json({ error: "Parametro no permitido." }, { status: 400 });
  }

  try {
    const db = await getDb();
    const allowOverCapacity = scope === "panel";
    const result =
      serviceIds.length > 0
        ? await computeBookableSlotsForTreatmentIdsDetailed(db, {
            dateKey,
            treatmentIds: serviceIds,
            now: new Date(),
            scope,
            excludeReservationHexId: scope === "panel" ? excludeReservationHexId || undefined : undefined,
            allowOverCapacity,
          })
        : await computeBookableSlotsDetailed(db, {
            dateKey,
            treatmentId,
            now: new Date(),
            scope,
            excludeReservationHexId: scope === "panel" ? excludeReservationHexId || undefined : undefined,
            allowOverCapacity,
          });
    return NextResponse.json({
      slots: result.slots,
      overCapacitySlots: result.overCapacitySlots,
    });
  } catch (e) {
    console.error("[api/booking/slots]", e);
    return NextResponse.json({ error: "No se pudieron cargar los horarios." }, { status: 500 });
  }
}
