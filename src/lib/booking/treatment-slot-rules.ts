/**
 * Reglas de agenda indicadas por el salón.
 *
 * Trabajos técnicos (días abiertos):
 *   → No pueden empezar después de las 14:00.
 */

// ─── Horarios de corte ────────────────────────────────────────────────────────

/** Último inicio permitido para trabajos técnicos. */
export const TECH_LATEST_START_TUE_FRI = "14:00";

// ─── Trabajos técnicos (id → durationMinutes) ────────────────────────────────

/**
 * Trabajos técnicos del salón con sus duraciones (en minutos).
 * Estos servicios tienen restricción de último horario de inicio.
 */
const TECHNICAL_TREATMENTS = new Map<string, number>([
  ["correccion-color", 90],
  ["color-global-corto", 120],
  ["color-global-medio", 120],
  ["color-global-largo", 120],
  ["reflejos-gorra-corto", 180],
  ["reflejos-gorra-medio", 180],
  ["reflejos-gorra-largo", 180],
  ["color-crecimiento", 90],
  ["color-crecimiento-mascara", 120],
  ["color-crecimiento-tratamiento", 150],
  ["color-crecimiento-corte-nutricion", 180],
  ["balayage-corto", 300],
  ["balayage-medio", 300],
  ["balayage-largo", 300],
  ["air-touch-corto", 300],
  ["air-touch-medio", 300],
  ["air-touch-largo", 300],
  ["mechas-papel-corto", 300],
  ["mechas-papel-medio", 300],
  ["mechas-papel-largo", 300],
  ["alisado-vegano-corto", 270],
  ["alisado-vegano-medio", 270],
  ["alisado-vegano-largo", 270],
  ["permanente-corto", 270],
  ["permanente-medio", 270],
  ["permanente-largo", 270],
  // Reservas antiguas (catálogo previo)
  ["servicio-completo", 90],
  ["color", 60],
  ["color-retoque-reflejos", 60],
  ["color-mechas-total", 90],
  ["mechas-contramechas", 120],
  ["balayage", 120],
  ["reflejos-gorra", 120],
  ["reflejos-papel-retoque", 90],
  ["reflejos-papel-completo", 120],
  ["barrido", 45],
  ["keratina", 60],
]);

// ─── API pública ──────────────────────────────────────────────────────────────

export function isTechnicalTreatment(treatmentId: string): boolean {
  return TECHNICAL_TREATMENTS.has(treatmentId);
}

/** Solo para reservas antiguas con keratina en el catálogo previo. */
export function treatmentIsKeratinaOnly1530(treatmentId: string): boolean {
  return treatmentId === "keratina";
}

export const KERATINA_ONLY_TIME_LOCAL = "15:00";

/**
 * Filtra los slots según las reglas de negocio del tratamiento.
 * `dateKey` se mantiene por compatibilidad con callers; ya no aplica regla especial de sábado.
 */
export function filterPublicSlotsByTreatmentRules(
  treatmentId: string | undefined,
  slots: string[],
  _dateKey?: string,
): string[] {
  if (!treatmentId) return slots;

  if (treatmentIsKeratinaOnly1530(treatmentId)) {
    return slots.filter((t) => t === KERATINA_ONLY_TIME_LOCAL);
  }

  if (!TECHNICAL_TREATMENTS.has(treatmentId)) return slots;

  return slots.filter((t) => t <= TECH_LATEST_START_TUE_FRI);
}

export const REFLEJOS_BALAYAGE_LATEST_START = TECH_LATEST_START_TUE_FRI;

export function treatmentRequiresStartNoLaterThan14(treatmentId: string): boolean {
  return TECHNICAL_TREATMENTS.has(treatmentId);
}
