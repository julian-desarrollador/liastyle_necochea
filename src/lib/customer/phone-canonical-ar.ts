import { normalizePhoneDigits } from "@/lib/booking/salon-availability";

/**
 * Clave canónica para cruzar el mismo WhatsApp argentino en cualquier formato.
 *
 * Formatos que normalizamos a "549XXXXXXXXXX":
 *   "+54 9 11 2345 6789"  → "5491123456789"   (full international, ya correcto)
 *   "11 2345 6789"        → "5491123456789"   (solo área + número, 10 dígitos)
 *   "9 11 2345 6789"      → "5491123456789"   (prefijo móvil arg sin país, 11 dígitos)
 *   "011 2345 6789"       → "5491123456789"   (prefijo discado 0 + área, 11 dígitos)
 *   "+54 11 2345 6789"    → "5491123456789"   (país sin 9 móvil)
 */
export function canonicalPhoneDigitsAR(raw: string): string {
  const d = normalizePhoneDigits(raw);
  if (!d) return "";

  // Ya tiene prefijo correcto
  if (d.startsWith("549")) return d;
  // Tiene código de país pero sin "9" móvil — agregarlo para identidad WhatsApp.
  if (d.startsWith("54")) return `549${d.slice(2)}`;

  // "0XXXXXXXXX…" (9–12 dígitos): prefijo de discado nacional en Argentina (trunk "0")
  // "011 2345 6789" → "01123456789" → strip "0" → "549" + "1123456789"
  if (d.startsWith("0") && d.length >= 9 && d.length <= 12) {
    return `549${d.slice(1)}`;
  }

  // "9XXXXXXXXXX" (exactamente 11 dígitos, empieza con "9"): prefijo móvil argentino
  // "9 11 2345 6789" → "91123456789" → strip "9" → "549" + "1123456789"
  if (d.startsWith("9") && d.length === 11) {
    return `549${d.slice(1)}`;
  }

  // Dígitos sueltos (8–10): área + número local → anteponer "549"
  if (d.length >= 8 && d.length <= 11) {
    return `549${d}`;
  }

  return d;
}

/**
 * Genera todos los valores posibles de `customerPhoneDigits` para el mismo número,
 * cubriendo la forma canónica actual Y las formas incorrectas que pueden estar guardadas
 * en registros creados antes de la corrección de la normalización.
 */
export function customerPhoneDigitsQueryValues(canonical: string): string[] {
  const s = new Set<string>();
  if (canonical) s.add(canonical);

  if (canonical.startsWith("549") && canonical.length >= 11) {
    const rest = canonical.slice(3); // p.ej. "1123456789" para CABA
    const last10 = rest.length >= 10 ? rest.slice(-10) : rest;

    s.add(rest);      // "1123456789"
    s.add(last10);    // igual si rest ya tiene 10 dígitos

    // Formas incorrectas que podían quedar guardadas con la normalización anterior:
    // "9 11..." (11 dígitos con prefijo "9") → `549${d}` daba "5499" + área + número
    s.add(`5499${last10}`); // "54991123456789"
    // "011..." (11 dígitos con prefijo "0") → `549${d}` daba "5490" + área + número
    s.add(`5490${last10}`); // "54901123456789"
    // "+54 11..." (sin "9" móvil) → se guardaba "54" + área + número
    s.add(`54${last10}`);   // "541123456789"

    if (rest !== last10) {
      // rest tiene más de 10 dígitos (número largo) → también variantes de rest
      s.add(`5499${rest}`);
      s.add(`5490${rest}`);
      s.add(`54${rest}`);
    }
  }

  return [...s];
}
