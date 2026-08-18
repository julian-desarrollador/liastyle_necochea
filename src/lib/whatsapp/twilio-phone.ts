import { canonicalPhoneDigitsAR } from "@/lib/customer/phone-canonical-ar";

/** Normaliza un teléfono argentino a `whatsapp:+549…` para Twilio. */
export function normalizeToWhatsAppE164(to: string): string {
  const canonical = canonicalPhoneDigitsAR(to);
  if (!canonical.startsWith("549") || canonical.length < 11) {
    throw new Error("Teléfono argentino inválido.");
  }
  return `whatsapp:+${canonical}`;
}

/** Extrae solo los dígitos de una dirección `whatsapp:+…`. */
export function whatsAppFromToDigits(from: string): string {
  return String(from ?? "")
    .replace(/^whatsapp:/i, "")
    .replace(/\D/g, "");
}
