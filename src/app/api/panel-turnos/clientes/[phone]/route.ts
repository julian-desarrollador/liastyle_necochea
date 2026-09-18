import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { serializePanelClientVisit } from "@/lib/panel/client-serialize";
import { canonicalPhoneDigitsAR } from "@/lib/customer/phone-canonical-ar";
import { getDb } from "@/lib/mongodb";
import {
  ClientIdentityConflictError,
  ClientIdentityInvalidError,
  ClientIdentityNotFoundError,
  updatePanelClientIdentity,
} from "@/lib/panel/update-client-identity";
import { verifyPanelCookie } from "@/lib/panel-turnos-auth";
import { listReservationsByPhoneDigits } from "@/lib/reservations/admin-queries";
import { ensureReservationIndexes } from "@/lib/reservations/service";
import { getVipManualForPhone, getDepositExemptManualForPhone } from "@/lib/vip/customer-profiles";
import { countPastVisits, resolveVipStatus } from "@/lib/vip/eligibility";
import { resolveDepositExempt } from "@/lib/reservations/deposit-exempt";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ phone: string }> }) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { phone: phoneParam } = await context.params;
  const phoneDigits = decodeURIComponent(phoneParam).trim();
  const canonical = canonicalPhoneDigitsAR(phoneDigits) || phoneDigits;

  if (!canonical || canonical.length < 8) {
    return NextResponse.json({ error: "Teléfono inválido." }, { status: 400 });
  }

  try {
    const db = await getDb();
    await ensureReservationIndexes(db);
    const visits = await listReservationsByPhoneDigits(db, canonical);
    if (visits.length === 0) {
      return NextResponse.json({ error: "Clienta no encontrada." }, { status: 404 });
    }

    const latest = visits[0];
    const pastVisitCount = countPastVisits(visits);
    const vipManual = await getVipManualForPhone(db, canonical);
    const vip = resolveVipStatus({ pastVisitCount, vipManual });
    const depositExemptManual = await getDepositExemptManualForPhone(db, canonical);
    const deposit = resolveDepositExempt({
      isVip: vip.isVip,
      depositExemptManual,
    });

    return NextResponse.json({
      client: {
        phoneDigits: latest.customerPhoneDigits ?? canonical,
        customerName: latest.customerName.trim() || "Cliente",
        customerPhone: latest.customerPhone.trim() || canonical,
        visitCount: pastVisitCount,
        isVip: vip.isVip,
        vipSource: vip.source,
        vipManual,
        threshold: vip.threshold,
        depositExempt: deposit.depositExempt,
        depositExemptSource: deposit.source,
        depositExemptManual,
      },
      visits: visits.map(serializePanelClientVisit),
    });
  } catch (e) {
    console.error("[api/panel-turnos/clientes/[phone] GET]", e);
    return NextResponse.json({ error: "No se pudo cargar la ficha." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ phone: string }> }) {
  const cookieStore = await cookies();
  if (!verifyPanelCookie(cookieStore.get("panel_turnos_auth")?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { phone: phoneParam } = await context.params;
  const phoneDigits = decodeURIComponent(phoneParam).trim();
  const canonical = canonicalPhoneDigitsAR(phoneDigits) || phoneDigits;
  if (!canonical || canonical.length < 8) {
    return NextResponse.json({ error: "Teléfono inválido." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const rawName =
    typeof body === "object" && body && "customerName" in body
      ? (body as { customerName?: unknown }).customerName
      : undefined;
  const rawPhone =
    typeof body === "object" && body && "customerPhone" in body
      ? (body as { customerPhone?: unknown }).customerPhone
      : undefined;

  if (typeof rawName !== "string" || typeof rawPhone !== "string") {
    return NextResponse.json({ error: "Nombre y WhatsApp son obligatorios." }, { status: 400 });
  }

  try {
    const db = await getDb();
    await ensureReservationIndexes(db);
    const result = await updatePanelClientIdentity(db, {
      currentPhoneDigits: canonical,
      customerName: rawName,
      customerPhone: rawPhone,
    });
    return NextResponse.json({ ok: true as const, ...result });
  } catch (e) {
    if (e instanceof ClientIdentityInvalidError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof ClientIdentityNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof ClientIdentityConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[api/panel-turnos/clientes/[phone] PUT]", e);
    return NextResponse.json({ error: "No se pudieron guardar los datos." }, { status: 500 });
  }
}
