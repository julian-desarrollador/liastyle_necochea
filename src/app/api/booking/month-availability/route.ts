import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildSalonCalendarItems } from "@/lib/booking/salon-availability";
import { computeMonthBookableFlags } from "@/lib/booking/compute-bookable-slots";
import { getDb } from "@/lib/mongodb";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { validateServiceCombo } from "@/lib/treatments/booking-rules";
import { findSalonTreatmentById } from "@/lib/treatments/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const monthIndex = Number(url.searchParams.get("monthIndex"));
  const treatmentId = url.searchParams.get("treatmentId")?.trim() ?? "";
  const serviceIds = (url.searchParams.get("serviceIds")?.trim() ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const scopeRaw = url.searchParams.get("scope")?.trim().toLowerCase() ?? "public";
  const scope = scopeRaw === "panel" ? "panel" : "public";

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Anio invalido." }, { status: 400 });
  }
  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return NextResponse.json({ error: "Mes invalido (monthIndex 0-11)." }, { status: 400 });
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
  }

  try {
    const db = await getDb();
    const now = new Date();
    const keys = buildSalonCalendarItems(year, monthIndex).map((d) => d.value);
    const availability = await computeMonthBookableFlags(db, {
      dateKeys: keys,
      now,
      scope,
      treatmentId: serviceIds.length > 0 ? undefined : treatmentId,
      treatmentIds: serviceIds.length > 0 ? serviceIds : undefined,
      allowOverCapacity: scope === "panel",
    });
    return NextResponse.json({ availability });
  } catch (e) {
    console.error("[api/booking/month-availability]", e);
    return NextResponse.json({ error: "No se pudo calcular la disponibilidad." }, { status: 500 });
  }
}
