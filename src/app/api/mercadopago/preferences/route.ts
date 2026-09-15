import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { createCheckoutProPreference } from "@/lib/mercadopago/create-preference";
import { attachPreferenceToReservation, findReservationByHexId } from "@/lib/reservations/service";

export const dynamic = "force-dynamic";

type Body = { reservationId?: string; checkoutToken?: string };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const reservationId = typeof body.reservationId === "string" ? body.reservationId.trim() : "";
  const checkoutToken = typeof body.checkoutToken === "string" ? body.checkoutToken.trim() : "";

  if (!reservationId || !checkoutToken) {
    return NextResponse.json({ error: "Faltan reservationId o checkoutToken." }, { status: 400 });
  }

  let oid: ObjectId;
  try {
    oid = new ObjectId(reservationId);
  } catch {
    return NextResponse.json({ error: "reservationId inválido." }, { status: 400 });
  }

  try {
    const db = await getDb();
    const reservation = await findReservationByHexId(db, reservationId);
    if (!reservation || !reservation._id.equals(oid)) {
      return NextResponse.json({ error: "Reserva no encontrada." }, { status: 404 });
    }

    if (reservation.reservationStatus !== "pending_payment") {
      return NextResponse.json({ error: "La reserva no admite pago en este estado." }, { status: 409 });
    }

    if (reservation.checkoutToken !== checkoutToken) {
      return NextResponse.json({ error: "Token de checkout inválido." }, { status: 403 });
    }

    const pref = await createCheckoutProPreference(reservation);
    if (!pref.ok) {
      console.error("[mercadopago/preferences]", pref.error);
      return NextResponse.json({ error: "No se pudo iniciar el pago con Mercado Pago." }, { status: 502 });
    }

    await attachPreferenceToReservation(db, oid, pref.preference.id);

    return NextResponse.json({
      preferenceId: pref.preference.id,
      initPoint: pref.preference.init_point,
      sandboxInitPoint: pref.preference.sandbox_init_point ?? null,
    });
  } catch (e) {
    if (
      e instanceof Error &&
      (e.message.includes("MERCADOPAGO") || e.message.includes("APP_BASE"))
    ) {
      console.error("[mercadopago/preferences] config", e);
      return NextResponse.json({ error: "Pago no configurado en el servidor." }, { status: 503 });
    }
    console.error("[mercadopago/preferences POST]", e);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}
