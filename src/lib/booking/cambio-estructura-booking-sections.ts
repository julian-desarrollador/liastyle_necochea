/** Grupos del modal de reserva — Cambio de estructura. */

/** Texto al ingresar (palabras de Analia). */
export const CAMBIO_ESTRUCTURA_INTRO = "Química capilar : Alisado o Permanente";

/**
 * Subtítulo de la card de portada (paso 1 de /turnos y /servicios).
 */
export const CAMBIO_ESTRUCTURA_CARD_SUBTITLE = "Alisado - Permanentación";

export type CambioEstructuraBookingGroup = {
  id: string;
  title: string;
  treatmentIds: string[];
};

export const CAMBIO_ESTRUCTURA_BOOKING_GROUPS: CambioEstructuraBookingGroup[] = [
  {
    id: "permanente",
    title: "Rulos permanente",
    treatmentIds: ["permanente-corto", "permanente-medio", "permanente-largo"],
  },
  {
    id: "alisado",
    title: "Alisado vegano sin formol",
    treatmentIds: ["alisado-vegano-corto", "alisado-vegano-medio", "alisado-vegano-largo"],
  },
];

/** Etiqueta corta en la reserva (el grupo ya indica el tipo de servicio). */
export const CAMBIO_ESTRUCTURA_BOOKING_LABELS: Record<string, string> = {
  "permanente-corto": "Corto (hombro)",
  "permanente-medio": "Medios",
  "permanente-largo": "Largos",
  "alisado-vegano-corto": "Corto (hombro)",
  "alisado-vegano-medio": "Medios",
  "alisado-vegano-largo": "Largos",
};

export const CAMBIO_ESTRUCTURA_PRICE_NOTICE =
  "El precio depende de lo procesado que esté el cabello.";
