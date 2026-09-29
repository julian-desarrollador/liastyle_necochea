import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isLikelyWhatsappNumber } from "@/lib/booking/salon-availability";
import {
  CUSTOMER_PROFILE_COOKIE,
  mintCustomerProfileToken,
  readCustomerProfilePhoneDigits,
} from "@/lib/customer/customer-session";
import { canonicalPhoneDigitsAR } from "@/lib/customer/phone-canonical-ar";
import { getDb } from "@/lib/mongodb";
import {
  ClientIdentityConflictError,
  ClientIdentityInvalidError,
  ClientIdentityNotFoundError,
  updatePanelClientIdentity,
} from "@/lib/panel/update-client-identity";
import { listReservationsByCustomerPhoneDigits } from "@/lib/reservations/customer-queries";
import { getCustomerNameForPhone, usableCustomerDisplayName } from "@/lib/vip/customer-profiles";

export const dynamic = "force-dynamic";

const COOKIE_MAX_AGE_SEC = 60 * 24 * 60 * 60;

function sessionDigitsOr401(raw: string | undefined) {
  const fromCookie = readCustomerProfilePhoneDigits(raw);
  if (!fromCookie) return null;
  return canonicalPhoneDigitsAR(fromCookie) || null;
}

function setSessionCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, phoneDigits: string) {
  cookieStore.set(CUSTOMER_PROFILE_COOKIE, mintCustomerProfileToken(phoneDigits), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });
}

function resolveDisplayName(
  profileName: string | null,
  reservationNames: Array<string | null | undefined>,
): string | null {
  if (profileName) return profileName;
  const usable = reservationNames.map((n) => usableCustomerDisplayName(n)).find((n) => n != null);
  if (usable) return usable;
  return reservationNames.find((n) => n?.trim())?.trim() ?? null;
}

export async function GET() {
  const cookieStore = await cookies();
  const digits = sessionDigitsOr401(cookieStore.get(CUSTOMER_PROFILE_COOKIE)?.value);
  if (!digits) {
    return NextResponse.json({ error: "No iniciaste sesión." }, { status: 401 });
  }

  try {
    const db = await getDb();
    const list = await listReservationsByCustomerPhoneDigits(db, digits);
    const displayName = resolveDisplayName(
      await getCustomerNameForPhone(db, digits),
      list.map((r) => r.customerName),
    );
    const customerPhone = list.find((r) => r.customerPhone?.trim())?.customerPhone?.trim() || digits;
    return NextResponse.json({ displayName, customerPhone });
  } catch (e) {
    console.error("[api/me/profile GET]", e);
    return NextResponse.json({ error: "No se pudieron cargar tus datos." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const digits = sessionDigitsOr401(cookieStore.get(CUSTOMER_PROFILE_COOKIE)?.value);
  if (!digits) {
    return NextResponse.json({ error: "No iniciaste sesión." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const rawName =
    typeof body === "object" && body && "displayName" in body
      ? String((body as { displayName: unknown }).displayName ?? "")
      : "";
  const customerName = rawName.trim().replace(/\s+/g, " ");
  if (customerName.length < 2) {
    return NextResponse.json({ error: "El nombre es demasiado corto." }, { status: 400 });
  }

  const rawPhone =
    typeof body === "object" && body && "customerPhone" in body
      ? String((body as { customerPhone: unknown }).customerPhone ?? "").trim()
      : "";
  if (!isLikelyWhatsappNumber(rawPhone)) {
    return NextResponse.json({ error: "Ingresá un WhatsApp válido (10 a 15 dígitos)." }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await updatePanelClientIdentity(db, {
      currentPhoneDigits: digits,
      customerName,
      customerPhone: rawPhone,
    });
    const phoneChanged = result.phoneDigits !== digits;
    if (phoneChanged) {
      setSessionCookie(cookieStore, result.phoneDigits);
    }
    return NextResponse.json({
      ok: true as const,
      displayName: result.customerName,
      customerPhone: result.customerPhone,
      phoneChanged,
    });
  } catch (e) {
    if (e instanceof ClientIdentityInvalidError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof ClientIdentityNotFoundError) {
      return NextResponse.json({ error: "No encontramos tu cuenta. Iniciá sesión de nuevo." }, { status: 404 });
    }
    if (e instanceof ClientIdentityConflictError) {
      return NextResponse.json(
        { error: "Ese WhatsApp ya tiene turnos de otra cuenta. Usá un número que no esté en uso." },
        { status: 409 },
      );
    }
    console.error("[api/me/profile PATCH]", e);
    return NextResponse.json({ error: "No se pudieron guardar tus datos." }, { status: 500 });
  }
}
