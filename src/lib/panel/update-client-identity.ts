import type { Db } from "mongodb";

import { canonicalPhoneDigitsAR, customerPhoneDigitsQueryValues } from "@/lib/customer/phone-canonical-ar";
import { listReservationsByPhoneDigits } from "@/lib/reservations/admin-queries";
import type { ReservationDoc } from "@/lib/reservations/types";
import {
  customerProfileRekeyWouldConflict,
  rekeyCustomerProfile,
  updateCustomerProfileName,
} from "@/lib/vip/customer-profiles";

const RESERVATIONS = "reservations";
const NAME_MIN = 2;
const NAME_MAX = 80;

export class ClientIdentityConflictError extends Error {
  constructor() {
    super("Ese WhatsApp ya está en otra ficha.");
    this.name = "ClientIdentityConflictError";
  }
}

export class ClientIdentityNotFoundError extends Error {
  constructor() {
    super("Clienta no encontrada.");
    this.name = "ClientIdentityNotFoundError";
  }
}

export class ClientIdentityInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientIdentityInvalidError";
  }
}

export type UpdateClientIdentityInput = {
  currentPhoneDigits: string;
  customerName: string;
  customerPhone: string;
};

export type UpdateClientIdentityResult = {
  phoneDigits: string;
  customerName: string;
  customerPhone: string;
};

function samePhoneIdentity(a: string, b: string): boolean {
  if (a === b) return true;
  const aKeys = new Set(customerPhoneDigitsQueryValues(a));
  return customerPhoneDigitsQueryValues(b).some((k) => aKeys.has(k));
}

export async function updatePanelClientIdentity(
  db: Db,
  input: UpdateClientIdentityInput,
): Promise<UpdateClientIdentityResult> {
  const customerName = input.customerName.trim();
  if (customerName.length < NAME_MIN || customerName.length > NAME_MAX) {
    throw new ClientIdentityInvalidError("El nombre debe tener entre 2 y 80 caracteres.");
  }

  const currentRaw = input.currentPhoneDigits.trim();
  const currentCanonical = canonicalPhoneDigitsAR(currentRaw) || currentRaw;
  if (!currentCanonical || currentCanonical.length < 8) {
    throw new ClientIdentityInvalidError("Teléfono inválido.");
  }

  const customerPhone = input.customerPhone.trim();
  const newCanonical = canonicalPhoneDigitsAR(customerPhone) || customerPhone.replace(/\D/g, "");
  if (!newCanonical || newCanonical.length < 8) {
    throw new ClientIdentityInvalidError("Teléfono inválido. Usá el WhatsApp con código de área.");
  }

  const visits = await listReservationsByPhoneDigits(db, currentCanonical);
  if (visits.length === 0) {
    throw new ClientIdentityNotFoundError();
  }

  const phoneIdentityChanged = !samePhoneIdentity(currentCanonical, newCanonical);

  if (phoneIdentityChanged) {
    const otherVisits = await listReservationsByPhoneDigits(db, newCanonical);
    if (otherVisits.length > 0) {
      throw new ClientIdentityConflictError();
    }
  }

  if (currentCanonical !== newCanonical) {
    if (await customerProfileRekeyWouldConflict(db, currentCanonical, newCanonical)) {
      throw new ClientIdentityConflictError();
    }
  }

  const oldKeys = customerPhoneDigitsQueryValues(currentCanonical);
  const now = new Date();

  await db.collection<ReservationDoc>(RESERVATIONS).updateMany(
    { customerPhoneDigits: { $in: oldKeys } },
    {
      $set: {
        customerName,
        customerPhone,
        customerPhoneDigits: newCanonical,
        updatedAt: now,
      },
    },
  );

  if (currentCanonical !== newCanonical) {
    const rekey = await rekeyCustomerProfile(db, currentCanonical, newCanonical, { customerName });
    if (rekey === "conflict") {
      throw new ClientIdentityConflictError();
    }
  } else {
    await updateCustomerProfileName(db, newCanonical, customerName);
  }

  return { phoneDigits: newCanonical, customerName, customerPhone };
}
